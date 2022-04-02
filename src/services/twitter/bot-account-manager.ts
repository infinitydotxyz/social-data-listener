import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, ListConfig } from './twitter.types';
import EventEmitter from 'events';
import { getSupportInfo } from 'prettier';
import { TwitterList } from './twitter-list';
import { TwitterConfig } from './twitter.config';
import { firestore } from '../../container';

export class BotAccountManager {
  private _botAccounts: BotAccount[] = [];

  private _lists: TwitterList[] = [];

  constructor(private twitterConfig: TwitterConfig) {}

  private async setup() {
    this._botAccounts = await this.initializeBotAccounts();

    const accountLists = await Promise.all(this._botAccounts.map((account) => account.getLists()));

    this._lists = accountLists.flatMap((lists) => lists);
  }

  private async initializeBotAccounts(): Promise<BotAccount[]> {
    const botAccountConfigs = await this.getBotAccountConfigs();
    const botAccounts = botAccountConfigs.map((botAccountConfig) => new BotAccount(botAccountConfig, this.twitterConfig));
    return botAccounts;
  }

  private async getBotAccountConfigs(): Promise<BotAccountConfig[]> {
    const accountsCollection = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL);
    const accounts = await accountsCollection.get();
    return accounts.docs.map((doc) => doc.data()) as BotAccountConfig[];
  }
}
