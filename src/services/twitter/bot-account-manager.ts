import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account/bot-account';
import { BotAccountConfig, Collection, ListMember, TwitterTweetEventPreCollectionData } from './twitter.types';
import { TwitterList } from './twitter-list/twitter-list';
import { TwitterConfig } from './twitter-config';
import { firestore } from '../../container';
import Emittery from 'emittery';
import { firestoreConstants, getCollectionDocId, getInfinityLink, trimLowerCase } from '@infinityxyz/lib/utils';
import ListAccountQueue from './list-account-queue';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { Collection as CollectionDoc, InfinityLinkType } from '@infinityxyz/lib/types/core';
import { BotAccountEventsType } from './bot-account/bot-account.events';
import { TwitterListEvent, TwitterListsEventsType } from './twitter-list/twitter-list.events';
import { BotAccountManagerEvent, BotAccountManagerEventsType, SubscriptionError } from './bot-account/bot-account-manager.events';

export class BotAccountManager extends Emittery<
  BotAccountManagerEventsType & BotAccountEventsType & TwitterListsEventsType & { docSnapshot: BotAccountConfig }
> {
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
      void this.emit(BotAccountManagerEvent.Subscription, {
        type: BotAccountManagerEvent.Subscription,
        ...this.baseEvent,
        username,
        collection,
        existingUserSubscriptions: Object.values(user.collections ?? {}).reduce((acc, curr) => {
          return `${acc ? ', ' + acc : ''}${curr.chainId}:${curr.address}`;
        }, '')
      });
    } catch (err: any) {
      let reason: SubscriptionError;
      if (err?.toString?.()?.includes('Could not find user with username')) {
        reason = SubscriptionError.InvalidUsername;
      } else if (err?.toString?.()?.includes('User has been suspended')) {
        reason = SubscriptionError.UserSuspended;
      } else {
        reason = SubscriptionError.Unknown;
      }
      void this.emit(BotAccountManagerEvent.ErroredSubscription, {
        type: BotAccountManagerEvent.ErroredSubscription,
        ...this.baseEvent,
        username,
        collection,
        reason,
        error: err?.toString?.()
      });
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
      void this.emit(BotAccountManagerEvent.UnSubscription, {
        type: BotAccountManagerEvent.UnSubscription,
        ...this.baseEvent,
        username: data.username,
        collection,
        subscriptionsRemaining: Object.values(data.collections ?? {}).reduce((acc, curr) => {
          return `${acc ? ', ' + acc : ''}${curr.chainId}:${curr.address}`;
        }, '')
      });
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
    return new Promise((resolve) => {
      firestore
        .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
        .doc(socialDataFirestoreConstants.TWITTER_DOC)
        .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
        .onSnapshot(async (accountsSnapshot) => {
          const addBotAccount = (accountConfig: BotAccountConfig) => {
            const isValidConfig = BotAccount.validateConfig(accountConfig);
            if (isValidConfig) {
              const botAccount = new BotAccount(accountConfig, this.twitterConfig, this._listAccountQueue, debug);
              this._botAccounts.set(accountConfig.username, botAccount);
              botAccount.onAny(async (eventName, data) => {
                if ('type' in data) {
                  switch (data.type) {
                    case TwitterListEvent.NewTweet:
                      try {
                        await this.handleTweetEvent(data.tweet);
                      } catch (err) {
                        console.error(err);
                      }
                      break;

                    default:
                      void this.emit(eventName, data);
                  }
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
        void this.emit(BotAccountManagerEvent.Tweet, {
          ...this.baseEvent,
          type: BotAccountManagerEvent.Tweet,
          tweet: event
        });
      }
    }
  }

  private get baseEvent() {
    let numLists = 0;
    let totalTweets = 0;
    this._botAccounts.forEach((account) => {
      totalTweets = account.totalTweets;
      numLists = account.numLists;
    });
    return {
      accounts: this._botAccounts.size,
      lists: numLists,
      totalTweets
    };
  }
}
