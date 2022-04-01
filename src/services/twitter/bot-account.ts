import { SlashCommandSubcommandBuilder } from '@discordjs/builders';
import phin from 'phin';
import { TwitterApi } from 'twitter-api-v2';
import { socialDataFirestoreConstants } from '../../constants';
import { BasicResponse, BotAccountConfig, BotAccountList, CreateListResponseData, TwitterListenerConfig } from './twitter.types';

export class BotAccount {
  private _client: TwitterApi;
  private setupMutex = false;

  private get _accountRef() {
    const accountRef = this.db
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
      .doc(this.accountConfig.username);
    return accountRef;
  }

  private get _tokenValid(): boolean {
    if (!this.accountConfig.refreshTokenValidUntil || typeof this.accountConfig.refreshTokenValidUntil !== 'number') {
      return false;
    }

    return this.accountConfig.refreshTokenValidUntil > Date.now() + 5 * 60 * 1000; // 5 minutes from now
  }

  constructor(
    public twitterListenerConfig: TwitterListenerConfig,
    private accountConfig: BotAccountConfig,
    private db: FirebaseFirestore.Firestore
  ) {
    this._client = new TwitterApi({
      clientId: this.accountConfig.clientId,
      clientSecret: this.accountConfig.clientSecret
    });

    this.setup();
  }

  private checkMutex() {
    if (this.setupMutex) {
      throw new Error('This method is not allowed to be called after setup()');
    }
    return;
  }

  private setup() {
    this.checkMutex();
    this.keepTokenFresh();
    this.listenForConfigChanges();
    this.setupMutex = true;
  }

  public async createList(name: string) {
    await this.db.runTransaction(async (tx) => {
      const config = (await tx.get(this._accountRef)).data() as BotAccountConfig;

      if (config.numLists + 1 > this.twitterListenerConfig.maxAccountsPerList) {
        throw new Error('This account has reached the max number of lists');
      }

      const { id } = await this.postCreateList(name);

      const listRef = this._accountRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).doc(id);

      const list: BotAccountList = {
        id: id,
        name: name,
        numMembers: 0
      };

      const updatedConfig: BotAccountConfig = {
        ...this.accountConfig,
        numLists: config.numLists + 1
      };

      tx.set(listRef, list);
      tx.set(this._accountRef, updatedConfig);
    });
  }

  private async postCreateList(name: string) {
    const response = await phin({
      method: 'POST',
      url: 'https://api.twitter.com/2/lists',
      headers: {
        Authorization: `Bearer ${this.accountConfig.accessToken}`
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
    this._accountRef.onSnapshot((snapshot) => {
      const data = snapshot.data() as BotAccountConfig;
      this.accountConfig = data;
    });
  }

  private async refreshToken(force?: boolean): Promise<void> {
    if (this._tokenValid && !force) {
      return;
    }

    const { accessToken, refreshToken, expiresIn } = await this._client.refreshOAuth2Token(this.accountConfig.refreshToken);

    if (!refreshToken) {
      throw new Error('failed to get refresh token');
    }

    const updatedConfig: BotAccountConfig = {
      ...this.accountConfig,
      accessToken,
      refreshToken,
      refreshTokenValidUntil: Date.now() + expiresIn * 1000
    };

    await this._accountRef.set(updatedConfig);
  }
}
