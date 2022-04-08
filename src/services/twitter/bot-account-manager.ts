import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, Collection, ListMember, TwitterTweetEventPreCollectionData } from './twitter.types';
import { TwitterList } from './twitter-list/twitter-list';
import { TwitterConfig } from './twitter-config';
import { firestore } from '../../container';
import chalk from 'chalk';
import Emittery from 'emittery';
import { firestoreConstants, getCollectionDocId, getInfinityLink, trimLowerCase } from '@infinityxyz/lib/utils';
import ListAccountQueue from './list-account-queue';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { Collection as CollectionDoc, InfinityLinkType } from '@infinityxyz/lib/types/core';

export class BotAccountManager extends Emittery<{
  tweetEvent: TwitterTweetEvent;
}> {
  private _botAccounts: Map<string, BotAccount> = new Map();
  private _isReady: Promise<void>;

  constructor(private twitterConfig: TwitterConfig, private _listAccountQueue: ListAccountQueue, debug = false) {
    super();
    this._isReady = this.initBotAccounts(debug);
  }

  static getCollectionKey(collection: Collection) {
    return `${collection.chainId}:${trimLowerCase(collection.address)}`;
  }

  public async subscribeCollectionToUser(username: string, collection: Collection) {
    await this._isReady;

    try {
      const user = await this.getUser(username);
      await this.unsubscribeFromAll(collection, [user]);
      if (user.addedToList && user.listId && user.listOwnerId) {
        await this.subscribeCollectionToExistingUser(user as ListMember, collection);
      } else {
        await this.subscribeCollectionToNewUser(username, collection);
      }
    } catch (err: any) {
      if (err?.toString?.()?.includes('Could not find user with username')) {
        console.log(`Invalid username: ${username}`);
      } else if (err?.toString?.()?.includes('User has been suspended')) {
        console.log(`User has been suspended: ${username}`);
      } else {
        console.error(`Failed to subscribe user: ${username} to collection: ${collection}`, err);
      }
    }
  }

  public async unsubscribeFromAll(collection: Collection, except: Partial<ListMember>[] = []) {
    const exceptUserIds = new Set(except.map((user) => user.userId));
    const exceptHandles = new Set(except.map((user) => user.username?.toLowerCase()));
    const listMembersRef = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_LIST_MEMBERS_COLL);
    const collectionKey = BotAccountManager.getCollectionKey(collection);
    const subscriptionsSnapshot = await listMembersRef.where(`collections.${collectionKey}.addedAt`, '>', 0).get();

    const batch = firestore.batch();
    for (const subscription of subscriptionsSnapshot.docs) {
      const data = subscription.data() as ListMember;
      if (exceptUserIds.has(data.userId) || exceptHandles.has(data.username?.toLowerCase())) {
        continue;
      }
      const collections = data.collections;
      delete collections[collectionKey];
      batch.update(subscription.ref, { collections });
    }
    await batch.commit();
  }

  private async subscribeCollectionToExistingUser(user: ListMember, collection: Collection) {
    const collectionKey = BotAccountManager.getCollectionKey(collection);

    const addedAt = user?.collections?.[collectionKey]?.addedAt ?? 0;
    if (addedAt > 0) {
      return; // Collection is already subscribed
    }

    await TwitterList.getMemberRef(user.userId).set(
      {
        collections: {
          [`${collectionKey}`]: {
            chainId: collection.chainId,
            address: trimLowerCase(collection.address),
            addedAt: Date.now()
          }
        }
      },
      { mergeFields: [`collections.${collectionKey}`] }
    );
  }

  private async subscribeCollectionToNewUser(username: string, collection: Collection): Promise<ListMember> {
    const collectionKey = BotAccountManager.getCollectionKey(collection);
    const botAccount = this.getBotAccountWithMinMembers();
    const user = await botAccount?.getUser(username);

    if (!user?.id) {
      throw new Error('Failed to get user');
    }

    const listMember: ListMember = {
      username: username.toLowerCase(),
      addedToList: 'queued',
      listId: '',
      listOwnerId: '',
      userId: user.id,
      collections: {
        [collectionKey]: {
          chainId: collection.chainId,
          address: trimLowerCase(collection.address),
          addedAt: Date.now()
        }
      }
    };

    await TwitterList.getMemberRef(listMember.userId).set(listMember);

    return listMember;
  }

  private getBotAccountWithMinMembers(): BotAccount | undefined {
    let minBotAccount: BotAccount | undefined;
    let botAccountMinMembers = Number.MAX_SAFE_INTEGER;

    for (const [, botAccount] of this._botAccounts) {
      const botAccountMembers = botAccount.getNumListsMembers();
      if (botAccountMembers < botAccountMinMembers) {
        minBotAccount = botAccount;
        botAccountMinMembers = botAccountMembers;
      }
    }
    return minBotAccount;
  }

  private getListByIds(
    botAccountId: string,
    listId: string
  ): { botAccount: BotAccount | undefined; list: TwitterList | undefined } {
    const botAccount = this._botAccounts.get(botAccountId);
    const list = botAccount?.getListById(listId);
    return { botAccount, list };
  }

  private async getUser(username: string): Promise<Partial<ListMember>> {
    const userSnap = await TwitterList.allMembersRef.where('username', '==', username.toLowerCase()).get();
    const existingUser = userSnap?.docs?.[0]?.data();

    if (!existingUser) {
      return {
        username
      };
    }

    return existingUser;
  }

  private botAccountsInitialized = false;
  private async initBotAccounts(debug = false): Promise<void> {
    if (this.botAccountsInitialized) {
      return;
    }
    this.botAccountsInitialized = true;
    let resolved = false;
    console.log(chalk.blue('Loading bot accounts...'));
    return new Promise((resolve) => {
      firestore
        .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
        .doc(socialDataFirestoreConstants.TWITTER_DOC)
        .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
        .onSnapshot(async (accountsSnapshot) => {
          const addBotAccount = (accountConfig: BotAccountConfig) => {
            const isValidConfig = BotAccount.validateConfig(accountConfig);
            if (isValidConfig) {
              console.log('Bot account added', accountConfig.username);
              const botAccount = new BotAccount(accountConfig, this.twitterConfig, this._listAccountQueue, debug);
              this._botAccounts.set(accountConfig.username, botAccount);
              botAccount.on('tweetEvent', async (event) => {
                try {
                  await this.handleTweetEvent(event.tweet);
                } catch (err) {
                  console.error(err);
                }
              });
            }
          };

          const changes = accountsSnapshot.docChanges();
          for (const change of changes) {
            if (change.type === 'added') {
              const accountConfig = change.doc.data() as BotAccountConfig;
              addBotAccount(accountConfig);
            } else if (change.type === 'removed') {
              console.log('Bot account removed', change.doc.id);
              this._botAccounts.delete(change.doc.id);
            } else if (change.type === 'modified') {
              const id = change.doc.id;
              if (!this._botAccounts.has(id)) {
                const accountConfig = change.doc.data() as BotAccountConfig;
                addBotAccount(accountConfig);
              }
            }
          }

          if (!resolved && this._botAccounts.size > 0) {
            for (const [, botAccount] of this._botAccounts) {
              await botAccount.isReady;
            }
            console.log(chalk.green(`Loaded: ${this._botAccounts.size} bot accounts`));
            resolve(); // Resolve once we have added at least one bot account
            resolved = true;
          }
        });
    });
  }

  private async handleTweetEvent(tweetEvent: TwitterTweetEventPreCollectionData) {
    const listMemberId = tweetEvent.authorId;
    const listMemberRef = TwitterList.getMemberRef(listMemberId);

    const listMemberSnap = await listMemberRef.get();
    const listMember = listMemberSnap.data() as ListMember;

    const collections = Object.values(listMember?.collections ?? {});

    if (collections.length === 0) {
      try {
        const { list } = this.getListByIds(listMember.listOwnerId, listMember.listId);
        if (!list) {
          throw new Error('Failed to find list to remove user from');
        }
        await list.removeMemberFromList(listMember);
      } catch (err) {
        console.error('Failed to delete list member', err);
      }
      return;
    }

    const getCollectionRef = (collection: Collection) => {
      const id = getCollectionDocId({ collectionAddress: collection.address, chainId: collection.chainId });
      return firestore.collection(firestoreConstants.COLLECTIONS_COLL).doc(id);
    };
    const collectionRefs = collections.map((item) => getCollectionRef(item));
    const collectionsSnapshot = await firestore.getAll(...collectionRefs);
    for (const snap of collectionsSnapshot) {
      const collection: CollectionDoc | undefined = snap.data() as CollectionDoc | undefined;

      if (collection) {
        const event: TwitterTweetEvent = {
          ...tweetEvent,
          chainId: collection.chainId,
          collectionAddress: collection.address,
          collectionName: collection.metadata.name,
          collectionSlug: collection.slug,
          collectionProfileImage: collection.metadata.profileImage,
          hasBlueCheck: collection.hasBlueCheck,
          internalUrl: getInfinityLink({ type: InfinityLinkType.Collection, addressOrSlug: collection.slug })
        };
        void this.emit('tweetEvent', event);
      }
    }
  }
}
