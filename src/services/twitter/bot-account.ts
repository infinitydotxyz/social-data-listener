import { socialDataFirestoreConstants } from '../../constants';
import { TwitterList } from './twitter-list';
import { BotAccountConfig, ListConfig, TwitterTweetEventPreCollectionData, UserIdResponseData } from './twitter.types';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { TwitterConfig } from './twitter-config';
import { TwitterClient, TwitterClientEvent } from './client/twitter-client';
import { v4 } from 'uuid';
import { BatchDebouncer } from '../../models/batch-debouncer';
import ListAccountQueue from './list-account-queue';
import { sleep } from '@infinityxyz/lib/utils';

type HandlerReturn = ({ output: UserIdResponseData; id: string } | { id: string; error: Error })[];
export class BotAccount extends ConfigListener<
  BotAccountConfig,
  {
    docSnapshot: BotAccountConfig;
    tweetEvent: { tweet: TwitterTweetEventPreCollectionData; botAccountId: string; listId: string };
  }
> {
  public client: TwitterClient;
  public isReady: Promise<void>;

  private listsInitialized = false;
  private _lists: Map<string, TwitterList> = new Map();
  private readonly _batchedGetUser: BatchDebouncer<string, UserIdResponseData> = this.getUsersDebouncer();

  constructor(
    accountConfig: BotAccountConfig,
    private _twitterConfig: TwitterConfig,
    private _listAccountQueue: ListAccountQueue,
    debug = false
  ) {
    super(accountConfig, BotAccount.ref(accountConfig.username));
    this.isReady = this.initLists();

    this.client = new TwitterClient(accountConfig, this.saveConfig.bind(this));
    this.on('docSnapshot', (config) => {
      this.client.updateConfig(config);
    });

    if (debug) {
      this.enableDebugging();
    }

    /**
     * Start getting users from the queue and adding them to lists
     */
    void this.addUsersToLists();
  }

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

  public async getUser(username: string) {
    const formattedUsername = username.toLowerCase();

    const user = await this._batchedGetUser.enqueue(formattedUsername, formattedUsername);
    if (!user?.id) {
      throw new Error(`Could not find user ${username}`);
    }

    return user;
  }

  public getNumListsMembers() {
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

  private async addUsersToLists() {
    await this.isReady;
    for (;;) {
      try {
        const account = await this._listAccountQueue.getAccount();

        if (!account) {
          await sleep(60_000); // Wait a min
          continue;
        }

        try {
          const list = await this.getListWithMinMembers();
          if (!list) {
            throw new Error('No list found');
          }
          await list?.addMemberToList(account);
        } catch (err) {
          /**
           * Re-enqueue user if we fail to add them to a list
           */
          await TwitterList.getMemberRef(account.userId).update({ addedToList: 'queued' });
        }
      } catch (err) {
        console.error('Failed to get account', err);
      }
    }
  }

  private async initLists(): Promise<void> {
    if (this.listsInitialized) {
      return;
    }
    this.listsInitialized = true;
    let resolved = false;
    return new Promise((resolve) => {
      this._docRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).onSnapshot(async (listConfigsSnapshot) => {
        const changes = listConfigsSnapshot.docChanges();
        for (const change of changes) {
          if (change.type === 'added') {
            const listConfig = change.doc.data() as ListConfig;
            this.addList(listConfig);
          } else if (change.type === 'removed') {
            console.log('List removed', change.doc.id);
            this._lists.delete(change.doc.id);
            await this._docRef.update({ numLists: firebaseAdmin.firestore.FieldValue.increment(-1) });
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
   * Create a list for the bot account to manage
   */
  public async createList(): Promise<TwitterList> {
    const name = this.getNewListName();
    let listConfig: ListConfig = {} as any;
    await firestore.runTransaction(async (tx) => {
      if (this._lists.size + 1 > this._twitterConfig.config.maxListsPerAccount) {
        throw new Error('This account has reached the max number of lists');
      }
      console.log(`Creating list ${name}`);
      const { id } = await this.client.createTwitterList(name);

      const listRef = this._docRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).doc(id);

      listConfig = {
        id: id,
        name: name,
        numMembers: 0,
        tweetPollInterval: this._twitterConfig.config.defaultTweetPollInterval,
        mostRecentTweetId: '',
        totalTweets: 0
      };

      tx.set(listRef, listConfig);
      tx.update(this._docRef, { numLists: firebaseAdmin.firestore.FieldValue.increment(1) });
    });

    if (!listConfig?.id) {
      throw new Error('Failed to create list');
    }
    return this.addList(listConfig);
  }

  private addList(listConfig: ListConfig): TwitterList {
    const existingList = this._lists.get(listConfig.id);
    if (existingList) {
      return existingList;
    }
    console.log(`List loaded: ${listConfig.name}`);
    const newList = new TwitterList(listConfig, this);
    newList.on('tweetEvent', (tweetEvent) => {
      void this.emit('tweetEvent', {
        tweet: tweetEvent,
        botAccountId: this.config.id,
        listId: listConfig.id
      });
    });

    this._lists.set(listConfig.id, newList);

    return newList;
  }

  private async saveConfig(config: Partial<BotAccountConfig>) {
    await this._docRef.update(config);
  }

  private getNewListName() {
    return `infinity_xyz_${v4()}`.substring(0, 20);
  }

  private enableDebugging() {
    const events = Object.values(TwitterClientEvent);
    for (const event of events) {
      this.client.on(event, (data) => {
        console.warn(event, data);
      });
    }
  }

  private getUsersDebouncer() {
    const handler = async (inputs: { value: string; id: string }[]): Promise<HandlerReturn> => {
      const usernames = inputs.map(({ value }) => value);
      const response = await this.client.getUsers(usernames);
      const users = response?.data ?? [];
      const errors = response?.errors ?? [];
      const results: HandlerReturn = [];
      for (const user of users) {
        results.push({
          id: user.username.toLowerCase(),
          output: user
        });
      }

      for (const error of errors) {
        results.push({
          id: error.value.toLowerCase(),
          error: new Error(error.detail)
        });
      }
      return results;
    };

    const debouncer = new BatchDebouncer<string, UserIdResponseData>(
      {
        timeout: 15_000,
        maxBatchSize: 100
      },
      handler
    );

    return debouncer;
  }
}
