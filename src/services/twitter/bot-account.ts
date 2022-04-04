import { socialDataFirestoreConstants } from '../../constants';
import { TwitterList } from './twitter-list';
import { BotAccountConfig, ListConfig } from './twitter.types';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { TwitterConfig } from './twitter-config';
import { TwitterClient } from './twitter-client';

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
    const oAuthReady = !!config.accessToken && !!config.refreshToken;

    return hasUsername && canRefresh && oAuthReady;
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

  public client: TwitterClient;

  public isReady: Promise<void>;
  constructor(accountConfig: BotAccountConfig, private _twitterConfig: TwitterConfig) {
    super(accountConfig, BotAccount.ref(accountConfig.username));
    this.isReady = this.initLists();

    this.client = new TwitterClient(accountConfig, this.saveConfig.bind(this));
    this.on('docSnapshot', (config) => {
      this.client.updateConfig(config);
    });
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
            const list = new TwitterList(listConfig, this, this._twitterConfig);
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

  /**
   * create a list for the bot account to manage
   */
  public async createList(name: string): Promise<TwitterList> {
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

    const list = new TwitterList(listConfig, this, this._twitterConfig);
    return list;
  }

  private async saveConfig(config: Partial<BotAccountConfig>) {
    await this._docRef.update(config);
  }
}
