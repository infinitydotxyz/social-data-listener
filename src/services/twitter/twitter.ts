import { SlashCommandSubcommandBuilder } from '@discordjs/builders';
import { FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants, sleep } from '@infinityxyz/lib/utils';
import { ApiResponseError, TweetV2SingleStreamResult, TwitterApi } from 'twitter-api-v2';
import Listener, { OnEvent } from '../listener';

export type TwitterOptions = {
  accessToken: string;
  refreshToken: string;
  listId: string;
  clientId: string;
  clientSecret: string;
};

export class Twitter extends Listener<TwitterTweetEvent> {
  private api: TwitterApi;
  private options: TwitterOptions;

  constructor(options: TwitterOptions, db: FirebaseFirestore.Firestore) {
    super(db);
    this.options = options;
    this.api = new TwitterApi(options.accessToken);
  }

  async setup(): Promise<void> {
    // this._config = (await this.configRef.get()).data() as TwitterListenerConfig;
    // this.listenForConfigChanges();

    // const botAccounts = await this.getBotAccounts();
    // this._botAccounts = botAccounts;

    // this._setupMutex = true;

    const query = this.db.collection(firestoreConstants.COLLECTIONS_COLL).where('state.create.step', '==', 'complete');

    query.onSnapshot(async (snapshot) => {
      const changes = snapshot.docChanges();

      for (const change of changes) {
        // skip collections w/o twitter url
        const url = change.doc.data().metadata?.links?.twitter;
        if (!url) continue;

        // skip invalid handles
        const handle = Twitter.extractHandle(url).trim();
        if (!handle) continue;

        // const user = await this.autoRetry(() => this.api.v2.userByUsername(handle));
        // if (user.data) {
        //   const userId = user.data.id;

        switch (change.type) {
          case 'added':
          case 'modified': // TODO: delete old account from the list when the twitter link is modified?
            // await this.autoRetry(() => this.api.v2.addListMember(listId, userId));

            break;
          case 'removed':
            // await this.autoRetry(() => this.api.v2.removeListMember(listId, userId));
            break;
        }

        //   console.log(`${change.type} ${user.data.name}`);
        // }
      }
    });
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
