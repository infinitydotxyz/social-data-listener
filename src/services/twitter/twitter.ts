/* eslint-disable @typescript-eslint/no-unused-vars */
import { Collection } from '@infinityxyz/lib/types/core/Collection';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import Listener, { OnEvent } from '../listener';
import { BotAccountManager } from './bot-account-manager';
import ListAccountQueue from './list-account-queue';
import { defaultTwitterConfig, TwitterConfig } from './twitter-config';
import { TwitterConfig as ITwitterConfig } from './twitter.types';

export type TwitterOptions = {
  accessToken: string;
  refreshToken: string;
  listId: string;
  clientId: string;
  clientSecret: string;
};

/**
 * TODO validate that we don't have extra/missing members/collections
 */
export class Twitter extends Listener<TwitterTweetEvent> {
  private botAccountManager!: BotAccountManager;
  private listAccountQueue!: ListAccountQueue;
  private twitterConfig!: TwitterConfig;

  constructor(db: FirebaseFirestore.Firestore) {
    super(db);
  }

  async setup(): Promise<void> {
    this.twitterConfig = await this.getTwitterConfig();
    this.listAccountQueue = new ListAccountQueue();
    const debug = true;
    this.botAccountManager = new BotAccountManager(this.twitterConfig, this.listAccountQueue, debug);
  }

  /**
   * Extracts the twitter handle from a twitter URL.
   */
  static extractHandle(url: string) {
    const split = url.replace(/\/+$/, '').split('/');
    return split[split.length - 1].replace('@', '');
  }

  /**
   * Appends a twitter handle to the twitter URL.
   */
  static appendHandle(handle: string) {
    return 'https://twitter.com/' + handle;
  }

  monitor(handler: OnEvent<TwitterTweetEvent>): void {
    this.monitorTwitterLinks();

    this.botAccountManager.on('tweetEvent', (tweet) => {
      console.log(`Received new Tweet from ${tweet.authorName}`);
      handler(tweet).catch(console.error);
    });
  }

  private monitorTwitterLinks() {
    const query = this.db.collection(firestoreConstants.COLLECTIONS_COLL).where('state.create.step', '==', 'complete');

    query.onSnapshot((snapshot) => {
      const changes = snapshot.docChanges();

      for (const change of changes) {
        // Skip collections w/o twitter url
        const collectionData = change.doc.data() as Partial<Collection>;
        const url = collectionData.metadata?.links?.twitter;
        if (!url || !collectionData.address || !collectionData.chainId) {
          continue;
        }

        // Skip invalid handles
        const handle = Twitter.extractHandle(url).trim().toLowerCase();
        if (!handle) {
          continue;
        }

        switch (change.type) {
          case 'added':
          case 'modified':
            this.botAccountManager
              .subscribeCollectionToUser(handle, {
                chainId: collectionData.chainId,
                address: collectionData.address
              })
              .catch(console.error);
            break;
          case 'removed':
            if (collectionData.chainId && collectionData.address) {
              this.botAccountManager
                .unsubscribeFromAll(
                  {
                    chainId: collectionData.chainId,
                    address: collectionData.address
                  },
                  []
                )
                .catch(console.error);
            }
            break;
        }
      }
    });
  }

  private async getTwitterConfig() {
    let initConfig = (await TwitterConfig.ref.get()).data() as ITwitterConfig;
    if (!initConfig) {
      await TwitterConfig.ref.set(defaultTwitterConfig);
      initConfig = defaultTwitterConfig;
    }

    const twitterConfig = new TwitterConfig(initConfig);
    return twitterConfig;
  }
}
