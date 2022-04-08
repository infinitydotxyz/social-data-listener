/* eslint-disable @typescript-eslint/no-unused-vars */
import { blockQuote } from '@discordjs/builders';
import { Collection } from '@infinityxyz/lib/types/core/Collection';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import chalk from 'chalk';
import Listener, { OnEvent } from '../listener';
import { BotAccountManager } from './bot-account-manager';
import {
  BotAccountManagerEvent,
  BotAccountManagerEvents,
  BotAccountManagerEventType
} from './bot-account/bot-account-manager.events';
import { BotAccountEvent, BotAccountEvents } from './bot-account/bot-account.events';
import ListAccountQueue from './list-account-queue';
import { defaultTwitterConfig, TwitterConfig } from './twitter-config';
import {
  TwitterListEvent,
  TwitterListEvents,
  TwitterListEventType,
  TwitterListsEventsType
} from './twitter-list/twitter-list.events';
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
    const debug = false;
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

    this.botAccountManager.onAny((eventName, event) => {
      if ('type' in event) {
        switch (event.type) {
          case BotAccountManagerEvent.Tweet:
            handler(event.tweet).catch(console.error);
            this.updateBotAccountManager(event);
            break;
          case BotAccountManagerEvent.Subscription:
          case BotAccountManagerEvent.UnSubscription:
          case BotAccountManagerEvent.ErroredSubscription:
            this.updateBotAccountManager(event);
            break;

          case TwitterListEvent.NewTweet:
          case TwitterListEvent.MemberAdded:
          case TwitterListEvent.MemberRemoved:
          case TwitterListEvent.PolledTweets:
            this.updateTwitterList(event);
            break;

          case BotAccountEvent.Loaded:
          case BotAccountEvent.ListLoaded:
          case BotAccountEvent.ListDeleted:
            this.updateBotAccount(event);
            break;

          default:
            console.log(`Unhandled event: ${eventName}`);
        }
      }
    });
  }

  private updateBotAccountManager(event: BotAccountManagerEvents) {
    let message = `[Bot Account Manager] Accounts: ${event.accounts} Lists: ${event.lists} Tweets: ${event.totalTweets}`;
    let logLevel = 'info';
    let eventType = '';
    switch (event.type) {
      case BotAccountManagerEvent.Tweet:
        eventType = ` Tweeted: ${event.tweet.text}`;
        break;
      case BotAccountManagerEvent.Subscription:
        eventType = ` Subscribed Collection: ${event.collection.address} to User: ${event.username}`;
        break;
      case BotAccountManagerEvent.UnSubscription:
        eventType = ` UnSubscribed Collection: ${event.collection.address} from User: ${event.username}`;
        break;
      case BotAccountManagerEvent.ErroredSubscription:
        eventType = ` Errored Subscription: ${event.collection.address} to User: ${event.username} ${chalk.yellow(event.reason)}`;
        break;
      default:
        eventType = ` Unhandled event: ${(event as any).type}`;
        logLevel = 'error';
    }
    const color = logLevel === 'error' ? 'red' : 'cyan';
    message = message + chalk.blue(eventType);
    console.log(chalk[color](message));
  }

  private updateBotAccount(event: BotAccountEvents) {
    const isRateLimited = event.addMemberRateLimitedUntil > Date.now();
    let logLevel = 'info';
    let message = `[Bot Account] [${event.account}] Lists: ${event.numLists} Total Tweets: ${event.totalTweets} Rate Limited: ${
      isRateLimited ? 'Yes' : 'No'
    }`;
    let eventType = '';
    switch (event.type) {
      case BotAccountEvent.Loaded:
        eventType = ` Loaded Account`;
        break;
      case BotAccountEvent.ListLoaded:
        eventType = ` Loaded List: ${event.list.name}`;
        break;
      case BotAccountEvent.ListDeleted:
        eventType = ` Deleted List: ${event.list}`;
        break;
      default:
        eventType = ` Unhandled event: ${(event as any).type}`;
        logLevel = 'error';
    }
    const color = logLevel === 'error' ? 'red' : 'cyan';
    message = message + chalk.blue(eventType);
    console.log(chalk[color](message));
  }

  private updateTwitterList(event: TwitterListEvents) {
    let message = `[Twitter List] [${event.list}] Members: ${event.listSize} Total Tweets: ${event.totalTweets}`;
    let logLevel = 'info';
    let eventType = '';
    switch (event.type) {
      case TwitterListEvent.NewTweet:
        // No logging for new tweets
        return;
      case TwitterListEvent.MemberAdded:
        eventType = ` Added Member: ${event.member.username}`;
        break;
      case TwitterListEvent.MemberRemoved:
        eventType = ` Removed Member: ${event.member.username}`;
        break;
      case TwitterListEvent.PolledTweets:
        eventType = ` Polled Tweets: ${event.tweetsPolled} New Tweets: ${event.newTweetsFound} Pages: ${event.pagesPolled}`;
        break;

      default:
        eventType = ` Unhandled event: ${(event as any).type}`;
        logLevel = 'error';
    }
    const color = logLevel === 'error' ? 'red' : 'cyan';
    message = message + chalk.blue(eventType);
    console.log(chalk[color](message));
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
