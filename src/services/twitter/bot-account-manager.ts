import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountConfig, TwitterListenerConfig } from './twitter.types';

export class BotAccountManager {
  private _setupMutex = false;

  private _config: TwitterListenerConfig;

  private _botAccounts: BotAccount[] = [];

  private get configRef(): FirebaseFirestore.DocumentReference<TwitterListenerConfig> {
    return this._db
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC) as any;
  }

  constructor(private _db: FirebaseFirestore.Firestore) {
    this._config = {} as any;
  }

  private async setup() {
    this._config = (await this.configRef.get()).data() as TwitterListenerConfig;
    this.listenForConfigChanges();
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
      this._botAccounts.forEach((botAccount) => {
        botAccount.twitterListenerConfig = this._config; // update configs
      });
    });
  }

  private async getBotAccounts(): Promise<BotAccount[]> {
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
