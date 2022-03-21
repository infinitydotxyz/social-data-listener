import { FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { StreamingV2AddRulesParams, TweetV2SingleStreamResult, TwitterApi } from 'twitter-api-v2';
import Listener, { OnEvent } from '../listener';
import TwitterConfig, { AccessLevel } from './config';
import { ruleLengthLimitations, ruleLimitations } from './limitations';

export class Twitter implements Listener<TwitterTweetEvent> {
  private api: TwitterApi;

  constructor(options: TwitterConfig) {
    if (!options.bearerToken) throw new Error('Bearer token must be set!');
    this.api = new TwitterApi(options.bearerToken);
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
    const res = await this.api.v2.streamRules();
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
    const res = await this.api.v2.updateStreamRules(rules);
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

    const res = await this.api.v2.updateStreamRules({
      delete: {
        ids
      }
    });

    return res.meta;
  }

  /**
   * Starts listening to a stream of tweets from all twitter users we have set in {@link updateStreamRules}.
   */
  private async streamTweets(onTweet: (tweet: TweetV2SingleStreamResult) => void) {
    const stream = await this.api.v2.searchStream({
      autoConnect: true,
      expansions: 'author_id,attachments.media_keys',
      'tweet.fields': 'author_id,created_at,id,lang,possibly_sensitive,source,text',
      'user.fields': 'location,name,profile_image_url,username,verified',
      'media.fields': 'height,width,preview_image_url,type,url,alt_text'
    });

    for await (const item of stream) {
      onTweet(item);
    }
  }

  monitor(handler: OnEvent<TwitterTweetEvent>): void {
    this.streamTweets((tweet) => {
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
    });
  }
}
