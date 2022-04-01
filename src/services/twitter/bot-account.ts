import phin from 'phin';
import { TwitterApi } from 'twitter-api-v2';
import { socialDataFirestoreConstants } from '../../constants';
import { TwitterList } from './twitter-list';
import {
  BasicResponse,
  BotAccountConfig,
  BotAccountListConfig,
  CreateListResponseData,
  TwitterListenerConfig,
  UserIdResponseData
} from './twitter.types';

export class BotAccount {
  private _client: TwitterApi;
  private _setupMutex = false;

  public get client() {
    return this._client;
  }

  get botAccountId() {
    return this._accountConfig.username;
  }

  get accountRef(): FirebaseFirestore.DocumentReference<BotAccountConfig> {
    const accountRef = this._db
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
      .doc(this._accountConfig.username) as any;
    return accountRef;
  }

  private get _tokenValid(): boolean {
    if (!this._accountConfig.refreshTokenValidUntil || typeof this._accountConfig.refreshTokenValidUntil !== 'number') {
      return false;
    }

    return this._accountConfig.refreshTokenValidUntil > Date.now() + 5 * 60 * 1000; // 5 minutes from now
  }

  get numLists() {
    return this._accountConfig.numLists;
  }

  constructor(
    public twitterListenerConfig: TwitterListenerConfig,
    private _accountConfig: BotAccountConfig,
    private _db: FirebaseFirestore.Firestore
  ) {
    this._client = new TwitterApi({
      clientId: this._accountConfig.clientId,
      clientSecret: this._accountConfig.clientSecret
    });

    this.setup();
  }

  private checkMutex() {
    if (this._setupMutex) {
      throw new Error('This method is not allowed to be called after setup()');
    }
    return;
  }

  private setup() {
    this.checkMutex();
    this.keepTokenFresh();
    this.listenForConfigChanges();
    this._setupMutex = true;
  }

  public async getUser(username: string): Promise<UserIdResponseData> {
    const response = await phin({
      method: 'GET',
      url: `https://api.twitter.com/2/users/by/username/${username}`,
      headers: {
        Authorization: `Bearer ${this._accountConfig.accessToken}`
      }
    });
    const buffer = response.body;
    const res: BasicResponse<UserIdResponseData> = JSON.parse(buffer.toString());

    if (response.statusCode !== 200) {
      throw new Error(`Failed to get user id: ${JSON.stringify(res, null, 2)}`);
    }

    return res.data;
  }

  public async getUserIds(usernames: string[]): Promise<UserIdResponseData[]> {
    const response = await phin({
      method: 'GET',
      url: 'https://api.twitter.com/2/users/by',
      headers: {
        Authorization: `Bearer ${this._accountConfig.accessToken}`
      },
      data: {
        usernames: usernames.join(',')
      }
    });

    const buffer = response.body;
    const res: BasicResponse<UserIdResponseData[]> = JSON.parse(buffer.toString());
    const data = res.data;
    if (response.statusCode !== 200 || !Array.isArray(data)) {
      throw new Error(`Failed to get user ids. Status Code: ${response.statusCode}`);
    }

    return data;
  }

  public async createList(name: string): Promise<TwitterList> {
    let listConfig: BotAccountListConfig = {} as any;
    await this._db.runTransaction(async (tx) => {
      const config = (await tx.get(this.accountRef)).data() as BotAccountConfig;

      if (config.numLists + 1 > this.twitterListenerConfig.maxAccountsPerList) {
        throw new Error('This account has reached the max number of lists');
      }

      const { id } = await this.postCreateList(name);

      const listRef = this.accountRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).doc(id);

      const listConfig: BotAccountListConfig = {
        id: id,
        name: name,
        numMembers: 0
      };

      const updatedConfig: BotAccountConfig = {
        ...this._accountConfig,
        numLists: config.numLists + 1
      };

      tx.set(listRef, listConfig);
      tx.set(this.accountRef, updatedConfig);
    });
    if (!listConfig?.id) {
      throw new Error('Failed to create list');
    }
    const list = new TwitterList(listConfig, this, this._db);
    return list;
  }

  private async postCreateList(name: string) {
    const response = await phin({
      method: 'POST',
      url: 'https://api.twitter.com/2/lists',
      headers: {
        Authorization: `Bearer ${this._accountConfig.accessToken}`
      },
      data: {
        name
      }
    });

    const buffer = response.body;
    const res: BasicResponse<CreateListResponseData> = JSON.parse(buffer.toString());
    const data = res.data;

    if (!data?.id) {
      throw new Error(`Failed to create list: ${JSON.stringify(res, null, 2)}`);
    }

    return {
      id: data.id,
      name: data.name
    };
  }

  private keepTokenFresh() {
    this.checkMutex();
    const refresh = async () => {
      try {
        await this.refreshToken();
      } catch (err) {
        console.error(`Failed to refresh token`, err);
      }
    };

    refresh().then(() => {
      setInterval(async () => {
        await refresh();
      }, 60_000);
    });
  }

  private listenForConfigChanges() {
    this.checkMutex();
    this.accountRef.onSnapshot((snapshot) => {
      const data = snapshot.data() as BotAccountConfig;
      this._accountConfig = data;
    });
  }

  private async refreshToken(force?: boolean): Promise<void> {
    if (this._tokenValid && !force) {
      return;
    }

    const { accessToken, refreshToken, expiresIn } = await this._client.refreshOAuth2Token(this._accountConfig.refreshToken);

    if (!refreshToken) {
      throw new Error('failed to get refresh token');
    }

    const updatedConfig: BotAccountConfig = {
      ...this._accountConfig,
      accessToken,
      refreshToken,
      refreshTokenValidUntil: Date.now() + expiresIn * 1000
    };

    await this.accountRef.set(updatedConfig);
  }
}
