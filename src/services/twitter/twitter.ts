import { Collection } from '@infinityxyz/lib/types/core/Collection';
import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants, sleep } from '@infinityxyz/lib/utils';
import { resolveConfigFile } from 'prettier';
import { ApiResponseError, TweetV2SingleStreamResult, TwitterApi } from 'twitter-api-v2';
import { socialDataFirestoreConstants } from '../../constants';
import { firestore } from '../../container';
import Listener, { OnEvent } from '../listener';
import { BotAccount } from './bot-account';
import { BotAccountManager } from './bot-account-manager';
import { TwitterClient } from './twitter-client';
import { defaultTwitterConfig, TwitterConfig } from './twitter-config';
import { TwitterList } from './twitter-list';
import { BotAccountConfig, TwitterConfig as ITwitterConfig } from './twitter.types';

export type TwitterOptions = {
  accessToken: string;
  refreshToken: string;
  listId: string;
  clientId: string;
  clientSecret: string;
};

/**
 * TODO validate that we don't have extra/missing members/collections
 * TODO monitor list tweets and save to db
 * TODO think about what happens if a username changes but user id stays the same
 */

export class Twitter extends Listener<TwitterTweetEvent> {
  private api: TwitterApi;
  private options: TwitterOptions;

  constructor(options: TwitterOptions, db: FirebaseFirestore.Firestore) {
    super(db);
    this.options = options;
    this.api = new TwitterApi(options.accessToken);
  }

  async setup(): Promise<void> {
    const twitterConfig = await this.getTwitterConfig();
    const debug = true;
    // const botAccountManager = new BotAccountManager(twitterConfig, debug);

    // const bayc = {
    //   address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    //   chainId: '1'
    // };

    // botAccountManager.on('tweet', (tweet: any) => {
    //   console.log(tweet);
    // });
    const twitterConfigRef = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC);

    const botAccountConfigRef = twitterConfigRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL).doc('ll0_0lj');

    const snap = await botAccountConfigRef.get();
    const config = snap.data() as BotAccountConfig;
    const botAccount = new BotAccount(config, twitterConfig, true);
    await botAccount.isReady;
    console.log(botAccount.config);

    const res = await botAccount.client.addListMembers('1511176754248957955', ['jfrazier_eth']);
    console.log(res);

    // client.addListMembers('1511176754248957955', ['jfrazier_eth'])

    // await botAccountManager.subscribeCollectionToUser('jfrazier_eth', bayc);
    // await botAccountManager.subscribeCollectionToUser('jfrazier_eth', bayc);
    // await botAccountManager.unsubscribeCollectionFromUser('jfrazier_eth', bayc);
    // await botAccountManager.subscribeCollectionToUser('jfrazier_eth', bayc);

    // const query = this.db.collection(firestoreConstants.COLLECTIONS_COLL).where('state.create.step', '==', 'complete');

    // query.onSnapshot(async (snapshot) => {
    //   const changes = snapshot.docChanges();
    //   console.log(`Received: ${changes.length} collections`);

    //   for (const change of changes) {
    //     // skip collections w/o twitter url
    //     const collectionData = change.doc.data() as Partial<Collection>;
    //     const url = collectionData.metadata?.links?.twitter;
    //     if (!url || !collectionData.address || !collectionData.chainId) continue;

    //     // skip invalid handles
    //     const handle = Twitter.extractHandle(url).trim();
    //     if (!handle) continue;

    //     switch (change.type) {
    //       case 'added':
    //       case 'modified':
    //         // TODO: delete old account from the list when the twitter link is modified?
    //         botAccountManager.subscribeCollectionToUser(handle, {
    //           chainId: collectionData.chainId,
    //           address: collectionData.address
    //         });
    //         break;
    //       case 'removed':
    //         botAccountManager.unsubscribeCollectionFromUser(handle, {
    //           chainId: collectionData.chainId,
    //           address: collectionData.address
    //         });
    //         break;
    //     }
    //   }
    // });
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

  /**
   * Automatically retries the request on rate limit. Also refreshes auth tokens automatically.
   */
  async autoRetry<T>(callback: () => T | Promise<T>) {
    while (true) {
      try {
        return await callback();
      } catch (error) {
        if (error instanceof ApiResponseError) {
          // retry on rate limit
          if (error.rateLimitError && error.rateLimit) {
            const resetTimeout = error.rateLimit.reset * 1000; // convert to ms time instead of seconds time
            const timeToWait = resetTimeout - Date.now();
            console.log(`Rate limit hit! Waiting ${timeToWait} ms...`);
            await sleep(timeToWait);
          }
          // retry when oauth tokens are expired
          else if (error.code === 401) {
            console.log('Tokens expired');
            // create a new client because for some reason mixing clientId with bearerToken from `this.Api` (accessToken) doesn't work properly (odd TS error)
            const client = new TwitterApi({
              clientId: this.options.clientId,
              clientSecret: this.options.clientSecret
            });
            const { accessToken, refreshToken } = await client.refreshOAuth2Token(this.options.refreshToken);
            console.log('new tokens success', accessToken, refreshToken);
            this.api = new TwitterApi(accessToken);
            this.options.accessToken = accessToken;
            if (refreshToken) this.options.refreshToken = refreshToken;
          }
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Starts listening to a stream of tweets from all twitter users we have set in {@link updateStreamRules}.
   */
  private async streamTweets(onTweet: (tweet: TweetV2SingleStreamResult) => void) {
    const stream = await this.autoRetry(() =>
      this.api.v2.searchStream({
        autoConnect: true,
        expansions: 'author_id,attachments.media_keys',
        'tweet.fields': 'author_id,created_at,id,lang,possibly_sensitive,source,text',
        'user.fields': 'location,name,profile_image_url,username,verified',
        'media.fields': 'height,width,preview_image_url,type,url,alt_text'
      })
    );

    for await (const item of stream) {
      onTweet(item);
    }
  }

  /**
   * Watch the list on twitter for new tweets.
   */
  private async watchList() {
    /* while (true) {
      console.log('watching watchlist');
      await sleep(1000);
    } */
    // TODO: watch lists (see: https://developer.twitter.com/en/docs/twitter-api/lists/list-tweets/introduction)
  }

  monitor(handler: OnEvent<TwitterTweetEvent>): void {
    this.watchList();
    /* this.streamTweets((tweet) => {
      const media = tweet.includes?.media?.[0];
      const user = tweet.includes?.users?.[0];

      return handler({
        id: tweet.data.id,
        type: FeedEventType.TwitterTweet,
        authorId: tweet.data.author_id,
        comments: 0,
        likes: 0,
        isSensitive: tweet.data.possibly_sensitive ?? false,
        language: tweet.data.lang ?? '',
        timestamp: new Date(tweet.data.created_at ?? new Date()).getTime(),
        image: media?.url ?? '',
        source: tweet.data.source ?? '',
        text: tweet.data.text ?? '',
        username: user?.username ?? ''
      });
    }); */
  }
}
