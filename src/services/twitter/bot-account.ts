import phin from 'phin';
import { TwitterApi } from 'twitter-api-v2';
import { socialDataFirestoreConstants } from '../../constants';
import { TwitterList } from './twitter-list';
import { BasicResponse, BotAccountConfig, CreateListResponseData, ListConfig, UserIdResponseData } from './twitter.types';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { TwitterConfig } from './twitter.config';

export class BotAccount extends ConfigListener<BotAccountConfig> {
  static ref(botAccountUsername: string) {
    const accountRef = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
      .doc(botAccountUsername) as FirebaseFirestore.DocumentReference<BotAccountConfig>;
    return accountRef;
  }

  static validateConfig(config: BotAccountConfig): boolean {
    const canRefresh = !!config.clientId && !!config.clientSecret;
    const oAuthReady = !!config.accessToken && !!config.refreshToken;

    return canRefresh && oAuthReady;
  }

  private _lists: Map<string, TwitterList> = new Map();

  public getListsMembers() {
    let sum = 0;
    for (const [, list] of this._lists) {
      sum += list.size;
    }
    return sum;
  }

  public getListWithMinMembers() {
    let minList: TwitterList | undefined;
    for (const [, list] of this._lists) {
      if (!minList || list.size < minList.size) {
        minList = list;
      }
    }
    return minList;
  }

  public getListById(id: string): TwitterList | undefined {
    return this._lists.get(id);
  }

  get authHeaders() {
    return {
      Authorization: `Bearer ${this.config.accessToken}`
    };
  }

  public isReady: Promise<void>;
  constructor(accountConfig: BotAccountConfig, private _twitterConfig: TwitterConfig) {
    super(accountConfig, BotAccount.ref(accountConfig.username));
    this.keepTokenFresh();
    this.isReady = this.initLists();
  }

  /**
   * get a user object from twitter via a username
   */
  public async getUser(username: string): Promise<UserIdResponseData> {
    const response = await phin({
      method: 'GET',
      url: `https://api.twitter.com/2/users/by/username/${username}`,
      headers: {
        ...this.authHeaders
      }
    });
    const buffer = response.body;
    const res: BasicResponse<UserIdResponseData> = JSON.parse(buffer.toString());

    if (response.statusCode !== 200) {
      throw new Error(`Failed to get user id: ${JSON.stringify(res, null, 2)}`);
    }

    return res.data;
  }

  private listsInitialized = false;
  private async initLists(): Promise<void> {
    if (this.listsInitialized) {
      return;
    }
    this.listsInitialized = true;
    let resolved = false;
    return new Promise((resolve) => {
      this._docRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).onSnapshot((listConfigsSnapshot) => {
        if (!resolved) {
          resolve();
          resolved = true;
        }

        const changes = listConfigsSnapshot.docChanges();
        for (const change of changes) {
          if (change.type === 'added') {
            console.log('List added', change.doc.id);
            const listConfig = change.doc.data() as ListConfig;
            const list = new TwitterList(listConfig, this, this._twitterConfig);
            this._lists.set(listConfig.id, list);
          } else if (change.type === 'removed') {
            console.log('List removed', change.doc.id);
            this._lists.delete(change.doc.id);
          }
        }
      });
    });
  }

  /**
   * create a list for the bot account to manage
   *
   * 1. create a list using the twitter api
   * 2. store list data in firestore
   * 3. increment the number of lists for the bot config
   */
  public async createList(name: string): Promise<TwitterList> {
    let listConfig: ListConfig = {} as any;
    await firestore.runTransaction(async (tx) => {
      const config = (await tx.get(this._docRef)).data() as BotAccountConfig;

      if (config.numLists + 1 > this._twitterConfig.config.maxListsPerAccount) {
        throw new Error('This account has reached the max number of lists');
      }

      const { id } = await this.createTwitterList(name);

      const listRef = this._docRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).doc(id);

      const listConfig: ListConfig = {
        id: id,
        name: name,
        numMembers: 0
      };

      tx.set(listRef, listConfig);
      tx.update(this._docRef, { numLists: firebaseAdmin.firestore.FieldValue.increment(1) });
    });

    if (!listConfig?.id) {
      throw new Error('Failed to create list');
    }

    const list = new TwitterList(listConfig, this, this._twitterConfig);
    return list;
  }

  private get _tokenValid(): boolean {
    if (!this.config.refreshTokenValidUntil || typeof this.config.refreshTokenValidUntil !== 'number') {
      return false;
    }

    return this.config.refreshTokenValidUntil > Date.now() + 5 * 60 * 1000; // 5 minutes from now
  }

  /**
   * create a list via the twitter api
   */
  private async createTwitterList(name: string) {
    const response = await phin({
      method: 'POST',
      url: 'https://api.twitter.com/2/lists',
      headers: {
        ...this.authHeaders
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

  async removeListMember(listId: string, memberId: string): Promise<{ isUserMember: boolean }> {
    const response = await phin({
      method: 'DELETE',
      url: `https://api.twitter.com/2/lists/${listId}/members/${memberId}`,
      headers: {
        ...this.authHeaders
      }
    });

    console.log(response.statusCode); // TODO what is this status code?
    const buffer = response.body;
    const res: BasicResponse<{ is_member: boolean }> = JSON.parse(buffer.toString());
    const data = res.data;

    const isUserMember = data?.is_member;

    return {
      isUserMember
    };
  }

  async addListMember(listId: string, memberId: string): Promise<{ isUserMember: boolean }> {
    const response = await phin({
      method: 'POST',
      url: `https://api.twitter.com/2/lists/${listId}/members`,
      headers: {
        ...this.authHeaders
      },
      data: {
        user_id: memberId
      }
    });

    console.log(response.statusCode); // TODO what is this status code?
    const buffer = response.body;
    const res: BasicResponse<{ is_member: boolean }> = JSON.parse(buffer.toString());
    const data = res.data;

    const isUserMember = data?.is_member;

    return {
      isUserMember
    };
  }

  private keepTokenFresh() {
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

  private async refreshToken(force?: boolean): Promise<void> {
    if (this._tokenValid && !force) {
      return;
    }

    const client = new TwitterApi({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret
    });

    const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(this.config.refreshToken);

    if (!refreshToken) {
      throw new Error('failed to get refresh token');
    }

    const expiresInMs = expiresIn * 1000;

    const refreshTokenValidUntil = Date.now() + expiresInMs;

    await this._docRef.update({ accessToken, refreshToken, refreshTokenValidUntil });
  }
}
