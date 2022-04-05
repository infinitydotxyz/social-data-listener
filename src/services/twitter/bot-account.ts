import { socialDataFirestoreConstants } from '../../constants';
import { TwitterList } from './twitter-list';
import { BotAccountConfig, ListConfig } from './twitter.types';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { TwitterConfig } from './twitter-config';
import { TwitterClient, TwitterClientEvent } from './twitter-client';
import { v4 } from 'uuid';

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
    const hasUsername = !!config.username;
    const canRefresh = !!config.clientId && !!config.clientSecret;
    const oAuthV1Ready = !!config.apiKey && !!config.apiKeySecret && !!config.accessTokenV1 && !!config.accessSecretV1;
    const oAuthV2Ready = !!config.accessTokenV2 && !!config.refreshTokenV2;

    return hasUsername && canRefresh && oAuthV1Ready && oAuthV2Ready;
  }

  public client: TwitterClient;

  public isReady: Promise<void>;

  private _lists: Map<string, TwitterList> = new Map();

  constructor(accountConfig: BotAccountConfig, private _twitterConfig: TwitterConfig, debug = false) {
    super(accountConfig, BotAccount.ref(accountConfig.username));
    this.isReady = this.initLists();

    this.client = new TwitterClient(accountConfig, this.saveConfig.bind(this));
    this.on('docSnapshot', (config) => {
      this.client.updateConfig(config);
    });

    if (debug) {
      this.enableDebugging();
    }
  }

  public getListsMembers() {
    let sum = 0;
    for (const [, list] of this._lists) {
      sum += list.size;
    }
    return sum;
  }

  public async getListWithMinMembers() {
    if (this._lists.size < this._twitterConfig.config.maxListsPerAccount) {
      try {
        const newList = await this.createList();
        return newList;
      } catch (err) {
        console.error('Failed to create a new list', err);
      }
    }

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

  private listsInitialized = false;
  private async initLists(): Promise<void> {
    if (this.listsInitialized) {
      return;
    }
    this.listsInitialized = true;
    let resolved = false;
    return new Promise((resolve) => {
      this._docRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).onSnapshot((listConfigsSnapshot) => {
        const changes = listConfigsSnapshot.docChanges();
        for (const change of changes) {
          if (change.type === 'added') {
            console.log('List added', change.doc.id);
            const listConfig = change.doc.data() as ListConfig;

            const list = new TwitterList(listConfig, this, this._twitterConfig, this.onTweet.bind(this));
            this._lists.set(listConfig.id, list);
          } else if (change.type === 'removed') {
            console.log('List removed', change.doc.id);
            this._lists.delete(change.doc.id);
            this._docRef.update({ numLists: firebaseAdmin.firestore.FieldValue.increment(-1) });
          }
        }

        if (!resolved) {
          resolve();
          resolved = true;
        }
      });
    });
  }

  private onTweet(tweet: any) {
    console.log('tweet', tweet); // TODO emit tweet
  }

  /**
   * create a list for the bot account to manage
   */
  public async createList(): Promise<TwitterList> {
    const name = this.getNewListName();
    let listConfig: ListConfig = {} as any;
    await firestore.runTransaction(async (tx) => {
      const config = (await tx.get(this._docRef)).data() as BotAccountConfig;

      if (config.numLists + 1 > this._twitterConfig.config.maxListsPerAccount) {
        throw new Error('This account has reached the max number of lists');
      }

      const { id } = await this.client.createTwitterList(name);

      const listRef = this._docRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).doc(id);

      listConfig = {
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

    const list = new TwitterList(listConfig, this, this._twitterConfig, this.onTweet.bind(this));
    return list;
  }

  private async saveConfig(config: Partial<BotAccountConfig>) {
    await this._docRef.update(config);
  }

  private getNewListName() {
    return v4().substring(0, 20);
  }

  private enableDebugging() {
    const events = Object.values(TwitterClientEvent);
    for (const event of events) {
      this.client.on(event, (data) => {
        console.warn(event, data);
      });
    }
  }
}
