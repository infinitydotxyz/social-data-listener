/* eslint-disable @typescript-eslint/no-unused-vars */
import { Collection } from '@infinityxyz/lib/types/core/Collection';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants, sleep } from '@infinityxyz/lib/utils';
import chalk from 'chalk';
import { stringify } from 'uuid';
import { socialDataFirestoreConstants } from '../../constants';
import { firestore } from '../../container';
import Listener, { OnEvent } from '../listener';
import { BotAccountManager } from './bot-account-manager';
import { BotAccountManagerEvent, BotAccountManagerEvents } from './bot-account/bot-account-manager.events';
import { BotAccountEvent, BotAccountEvents } from './bot-account/bot-account.events';
import ListAccountQueue from './list-account-queue';
import { defaultTwitterConfig, TwitterConfig } from './twitter-config';
import { TwitterListEvent, TwitterListEvents } from './twitter-list/twitter-list.events';
import { ListMember, TwitterConfig as ITwitterConfig } from './twitter.types';

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
    void this.requeueFailedAccounts();

    void this.totalMembers();
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
    console.log(this.currentTime(), chalk[color](message));
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
    console.log(this.currentTime(), chalk[color](message));
  }

  private updateTwitterList(event: TwitterListEvents) {
    const rateLimitMessage = `Rate Limited: ${
      event.addingRateLimitedUntil > Date.now()
        ? chalk.red('Yes ' + this.formatDuration(event.addingRateLimitedUntil - Date.now()))
        : chalk.green('No')
    }`;
    let message = `[Twitter List] [${event.list}] Members: ${event.listSize} Total Tweets: ${event.totalTweets} ${rateLimitMessage}`;
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
    console.log(this.currentTime(), chalk[color](message));
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

  private async totalMembers() {
    const listMembers = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_LIST_MEMBERS_COLL);
    const stream = listMembers.stream();
    const botAccounts: Map<string, { numMembers: number }> = new Map();
    const lists: Map<string, { numMembers: number }> = new Map();
    const members: ListMember[] = [];

    for await (const memberSnap of stream) {
      const member = (memberSnap as any as FirebaseFirestore.DocumentSnapshot<ListMember>).data();
      if (member) {
        members.push(member);
      }
      if (member?.listOwnerId && !botAccounts.has(member?.listOwnerId)) {
        botAccounts.set(member.listOwnerId, { numMembers: 0 });
      }

      if (member?.listId && !lists.has(member?.listId)) {
        lists.set(member.listId, { numMembers: 0 });
      }

      if (member?.listOwnerId) {
        const acc = botAccounts.get(member.listOwnerId);
        if (acc) {
          acc.numMembers += 1;
        }
      }

      if (member?.listId) {
        const acc = lists.get(member.listId);
        if (acc) {
          acc.numMembers += 1;
        }
      }
    }

    console.log(`Lists`);
    let totalListMembers = 0;
    for (const [key, value] of lists) {
      console.log(key, value);
      totalListMembers += value.numMembers;
    }
    console.log(`Total List Members: ${totalListMembers}`);

    console.log(`Bot Accounts`);
    let totalAccMembers = 0;
    for (const [key, value] of botAccounts) {
      console.log(key, value);
      totalAccMembers += value.numMembers;
    }
    console.log(`Total Bot Account Members: ${totalAccMembers}`);

    console.log(`Total Members: ${members.length}`);
  }

  private async requeueFailedAccounts() {
    let numResults = 0;
    const maxResults = 300;
    const ONE_HOUR = 60 * 60 * 1000;
    for (;;) {
      try {
        const listMembers = firestore
          .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
          .doc(socialDataFirestoreConstants.TWITTER_DOC)
          .collection(socialDataFirestoreConstants.TWITTER_LIST_MEMBERS_COLL);
        const TWENTY_EIGHT_HOURS = 1000 * 60 * 60 * 28;
        const expired = Date.now() - TWENTY_EIGHT_HOURS;
        const snapshot = await listMembers
          .where('addedToList', '==', 'pending')
          .where('pendingSince', '<=', expired)
          .limit(maxResults)
          .get();
        const batch = firestore.batch();
        snapshot.forEach((doc) => {
          batch.update(doc.ref, { addedToList: 'queued' });
        });

        numResults = snapshot.docs.length;
        await batch.commit();

        console.log(`Re-queued ${numResults} accounts`);
      } catch (err) {
        console.log(`Failed to re-queue failed accounts`, err);
        numResults = 0;
      }

      if (numResults < maxResults) {
        await sleep(ONE_HOUR);
      }
    }
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

  private formatDuration(duration: number) {
    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / 1000 / 60) % 60);
    const hours = Math.floor((duration / 1000 / 60 / 60) % 24);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  private currentTime() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    return `[${hours}:${minutes}:${seconds}]`;
  }
}
