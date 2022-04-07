import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, Collection, ListMember } from './twitter.types';
import { TwitterList } from './twitter-list';
import { TwitterConfig } from './twitter-config';
import { firestore } from '../../container';
import chalk from 'chalk';
import Emittery from 'emittery';
import { trimLowerCase } from '@infinityxyz/lib/utils';
import ListAccountQueue from './list-account-queue';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed/TwitterEvent';

export class BotAccountManager extends Emittery<{
  tweetEvent: { tweet: TwitterTweetEvent; botAccountId: string; listId: string };
}> {
  static getCollectionKey(collection: Collection) {
    return `${collection.chainId}:${trimLowerCase(collection.address)}`;
  }

  private _botAccounts: Map<string, BotAccount> = new Map();

  private isReady: Promise<void>;
  constructor(private twitterConfig: TwitterConfig, private _listAccountQueue: ListAccountQueue, debug = false) {
    super();
    this.isReady = this.initBotAccounts(debug);
  }

  public async subscribeCollectionToUser(username: string, collection: Collection) {
    await this.isReady;

    try {
      // TODO get collection's current subscription and unsubscribe
      const user = await this.getUser(username);
      if (user.addedToList && user.listId && user.listOwnerId) {
        await this.subscribeCollectionToExistingUser(user as ListMember, collection);
      } else {
        await this.subscribeCollectionToNewUser(username, collection);
      }
    } catch (err) {
      console.error(`Failed to subscribe user: ${username} to collection: ${collection}`, err);
    }
  }

  private async subscribeCollectionToExistingUser(user: ListMember, collection: Collection) {
    const collectionKey = BotAccountManager.getCollectionKey(collection);

    if (user.collections[collectionKey].addedAt > 0) {
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
        [`${collectionKey}`]: {
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
}
