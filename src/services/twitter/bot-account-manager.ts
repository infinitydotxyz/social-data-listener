import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, Collection, ListMember } from './twitter.types';

import { TwitterList } from './twitter-list';
import { TwitterConfig } from './twitter.config';
import { firestore } from '../../container';

export class BotAccountManager {
  private _botAccounts: Map<string, BotAccount> = new Map();

  private isReady: Promise<void>;
  constructor(private twitterConfig: TwitterConfig) {
    this.isReady = this.initBotAccounts();
  }

  private getListByIds(botAccountId: string, listId: string) {
    const botAccount = this._botAccounts.get(botAccountId);
    const list = botAccount?.getListById(listId);
    return list;
  }

  public async addUserToList(username: string, collection: Collection) {
    await this.isReady;
    try {
      const user = await this.getUser(username);
      let list: TwitterList | undefined;

      if (user.listId && user.listOwnerId) {
        list = this.getListByIds(user.listOwnerId, user.listId);
      }

      if (!list) {
        const botAccount = this.getBotAccountWithMinMembers();
        list = botAccount?.getListWithMinMembers();
      }

      if (!list) {
        throw new Error('No list found');
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
        list = this.getListByIds(user.listOwnerId, user.listId);

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
    return new Promise((resolve) => {
      firestore
        .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
        .doc(socialDataFirestoreConstants.TWITTER_DOC)
        .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
        .onSnapshot((accountsSnapshot) => {
          const addBotAccount = (accountConfig: BotAccountConfig) => {
            const isValidConfig = BotAccount.validateConfig(accountConfig);
            if (isValidConfig) {
              console.log('Bot account added', accountConfig.username);
              const botAccount = new BotAccount(accountConfig, this.twitterConfig);
              this._botAccounts.set(accountConfig.username, botAccount);
              if (!resolved) {
                resolve(); // resolve once we have added at least one bot account
                resolved = true;
              }
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
        });
    });
  }
}
