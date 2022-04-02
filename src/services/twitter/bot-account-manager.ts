import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, TwitterListenerConfig } from './twitter.types';
import EventEmitter from 'events';
import { getSupportInfo } from 'prettier';
import { TwitterList } from './twitter-list';

export class BotAccountManager extends EventEmitter {
  private _setupMutex = false;

  private _config: TwitterListenerConfig;

  private _botAccounts: BotAccount[] = [];

  private _lists: TwitterList[] = [];

  private _setupPromise: Promise<void>;

  private get configRef(): FirebaseFirestore.DocumentReference<TwitterListenerConfig> {
    return this._db
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC) as any;
  }

  constructor(private _db: FirebaseFirestore.Firestore) {
    super();
    this._config = {} as any;

    this._setupPromise = this.setup();
  }

  private getNextList() {
    let list = this._lists.shift();
    if (!list) {
      throw new Error('No more lists');
    }

    // round robin selection
    while (list!.size >= this._config.maxAccountsPerList) {
      this._lists.push(list);
      list = this._lists.shift();
      if (!list) {
        throw new Error('No more lists');
      }
    }

    return list;
  }

  private async setup() {
    this.checkMutex();
    this._setupMutex = true;
    this._config = (await this.configRef.get()).data() as TwitterListenerConfig;
    this.listenForConfigChanges();
    this._botAccounts = await this.initializeBotAccounts();

    const accountLists = await Promise.all(this._botAccounts.map((account) => account.getLists()));

    this._lists = accountLists.flatMap((lists) => lists);
  }

  private checkMutex() {
    if (this._setupMutex) {
      throw new Error('This method is not allowed to be called after setup()');
    }
    return;
  }

  private listenForConfigChanges() {
    this.checkMutex();
    this.configRef.onSnapshot((snapshot) => {
      const data = snapshot.data() as TwitterListenerConfig;
      this._config = data;
      this.emit('configChange', this._config);
    });
  }

  private async initializeBotAccounts(): Promise<BotAccount[]> {
    const botAccountConfigs = await this.getBotAccountConfigs();
    const botAccounts = botAccountConfigs.map((botAccountConfig) => new BotAccount(this._config, botAccountConfig, this._db));
    return botAccounts;
  }

  private async getBotAccountConfigs(): Promise<BotAccountConfig[]> {
    const accountsCollection = this._db
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL);
    const accounts = await accountsCollection.get();
    return accounts.docs.map((doc) => doc.data()) as BotAccountConfig[];
  }
}
