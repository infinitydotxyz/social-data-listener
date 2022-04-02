import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, Collection, ListMember } from './twitter.types';

import { TwitterList } from './twitter-list';
import { TwitterConfig } from './twitter.config';
import { firestore } from '../../container';
import chalk from 'chalk';
import { v4 } from 'uuid';

/**
 * TODO validate that we don't have extra/missing members/collections
 * TODO monitor list tweets and save to db
 * TODO handle errors and rate limits
 */

export class BotAccountManager {
  private _botAccounts: Map<string, BotAccount> = new Map();

  private isReady: Promise<void>;
  constructor(private twitterConfig: TwitterConfig) {
    this.isReady = this.initBotAccounts();
  }

  private getNewListName() {
    return v4().substring(0, 20);
  }

  public async addUserToList(username: string, collection: Collection) {
    await this.isReady;
    try {
      const user = await this.getUser(username);

      let list: TwitterList | undefined;
      let botAccount: BotAccount | undefined;

      if (user.listId && user.listOwnerId) {
        const res = this.getListByIds(user.listOwnerId, user.listId);
        botAccount = res.botAccount;
        list = res.list;
      }

      if (!list) {
        botAccount = this.getBotAccountWithMinMembers();
        list = botAccount?.getListWithMinMembers();
      }

      if (!botAccount) {
        throw new Error('No bot account found');
      } else if (!list || list.size > this.twitterConfig.config.maxMembersPerList) {
        list = await botAccount.createList(this.getNewListName());
      }

      await list.onCollectionAddUsername(username, collection);
    } catch (err) {
      console.error('Failed to add user to list', err);
    }
  }

  public async removeUserFromList(username: string, collection: Collection) {
    await this.isReady;
    try {
      const user = await this.getUser(username);
      let list: TwitterList | undefined;

      if (!user.listId || !user.listOwnerId) {
        const ref = TwitterList.getMemberRef(username);
        await ref.delete();
      } else {
        const res = this.getListByIds(user.listOwnerId, user.listId);
        list = res.list;

        if (!list) {
          throw new Error('List not found');
        }
        await list.onCollectionRemoveUsername(username, collection);
      }
    } catch (err) {
      console.error('Failed to remove user from list', err);
    }
  }

  private getBotAccountWithMinMembers(): BotAccount | undefined {
    let minBotAccount: BotAccount | undefined;
    let botAccountMinMembers = Number.MAX_SAFE_INTEGER;

    for (const [, botAccount] of this._botAccounts) {
      const botAccountMembers = botAccount.getListsMembers();
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
    const userSnap = await TwitterList.allMembersRef.where('username', '==', username).get();
    const existingUser = userSnap?.docs?.[0]?.data();

    if (!existingUser) {
      return {
        username
      };
    }

    return existingUser;
  }

  private botAccountsInitialized = false;
  private async initBotAccounts(): Promise<void> {
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
              const botAccount = new BotAccount(accountConfig, this.twitterConfig);
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
            resolve(); // resolve once we have added at least one bot account
            resolved = true;
          }
        });
    });
  }
}
