import { FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants, sleep } from '@infinityxyz/lib/utils';
import {
  ApiResponseError,
  IClientSettings,
  StreamingV2AddRulesParams,
  TweetV2SingleStreamResult,
  TwitterApi
} from 'twitter-api-v2';
import Listener, { OnEvent } from '../listener';
import { AccessLevel } from './access-level';
import { ruleLengthLimitations, ruleLimitations } from './limitations';

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
    // TODO: support multiple list ids -> should probably store the list id that a collection belongs to in db for easier list member management
    const listId = this.options.listId;

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

        const user = await this.autoRetry(() => this.api.v2.userByUsername(handle));
        if (user.data) {
          const userId = user.data.id;

          switch (change.type) {
            case 'added':
            case 'modified': // TODO: delete old account from the list when the twitter link is modified?
              await this.autoRetry(() => this.api.v2.addListMember(listId, userId));
              break;
            case 'removed':
              await this.autoRetry(() => this.api.v2.removeListMember(listId, userId));
              break;
          }

          console.log(`${change.type} ${user.data.name}`);
        }
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
   * Fetches all configured stream rule ids.
   */
  async getStreamRuleIds() {
    const rules = await this.getStreamRules();
    const ids = rules.map((rule) => rule.id);
    return ids;
  }

  /**
   * Fetches all configured stream rules.
   */
  async getStreamRules() {
    const res = await this.autoRetry(() => this.api.v2.streamRules());
    return res.data ?? [];
  }

  /**
   * Dynamically build efficient stream rules by keeping in mind Twitter's API limits.
   *
   * Example resulting rule: `(from:sleeyax OR from:jfrazier) -is:retweet -is:reply -is:quote`
   */
  buildStreamRules(
    accounts: string[],
    accessLevel: AccessLevel = AccessLevel.Essential,
    filter: string = '-is:retweet -is:reply -is:quote'
  ): StreamingV2AddRulesParams {
    // TODO: check if there's a more performant (but also readable) way to do this...

    const placeholder = `()${filter.length ? ' ' + filter : ''}`;
    const concatenator = ' OR ';
    const rules: Array<{ value: string }> = [];
    const maxRules = ruleLimitations[accessLevel];
    const maxRuleLength = ruleLengthLimitations[accessLevel];

    let offset = 0;
    let fromAccounts = accounts.map((account) => 'from:' + account);
    for (let i = 1; i <= fromAccounts.length; i++) {
      const slice = fromAccounts.slice(offset, i);
      const current = slice.join(concatenator);

      if (placeholder.length + current.length > maxRuleLength) {
        // set offset to index of the last item in the current slice.
        // this will make sure that, on the next iteration of the loop, we start with the item that we're now excluding.
        offset = slice.length - 1;
        // push the joined slice w/o the last item (which would exceed the max rule length otherwise) to the rules array
        const previous = slice.slice(0, offset).join(concatenator);
        rules.push({ value: placeholder.replace('()', `(${previous})`) });
      }
    }

    // push any remaining rules
    if (offset < fromAccounts.length)
      rules.push({ value: placeholder.replace('()', `(${fromAccounts.slice(offset, fromAccounts.length).join(concatenator)})`) });

    if (rules.length > maxRules) {
      console.warn(
        `Max number of stream rules reached (${rules.length}/${maxRules}). Rules that exceed this limit will be stripped to avoid API errors!`
      );
      return {
        add: rules.slice(0, maxRules)
      };
    }

    return {
      add: rules
    };
  }

  /**
   * Set the twiter handles to watch for tweets.
   *
   * Please beware of rate limits! See link.
   *
   * @link https://developer.twitter.com/en/docs/twitter-api/tweets/filtered-stream/introduction
   */
  async updateStreamRules(accounts: string[]) {
    const rules = this.buildStreamRules(accounts);
    const res = await this.autoRetry(() => this.api.v2.updateStreamRules(rules));
    if (res.errors?.length) {
      console.error(res.errors);
      throw new Error('Failed to update stream rules. See the API error above.');
    }
    return res.data;
  }

  /**
   * Remove all saved stream rules.
   *
   * The stream will become empty until we add accounts again.
   */
  async deleteStreamRules() {
    const ids = await this.getStreamRuleIds();

    if (ids.length == 0) return;

    const res = await this.autoRetry(() =>
      this.api.v2.updateStreamRules({
        delete: {
          ids
        }
      })
    );

    return res.meta;
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
