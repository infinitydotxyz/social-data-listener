import { StreamingV2AddRulesParams, TweetV2, TwitterApi } from 'twitter-api-v2';
import TwitterConfig, { AccessLevel } from './config';
import { ruleLengthLimitations, ruleLimitations } from './limitations';

export class Twitter {
  private api: TwitterApi;

  constructor(options: TwitterConfig) {
    if (!options.apiKey || !options.apiKeySecret) throw new Error('Missing API keys! Check your environment variables.');

    this.api = new TwitterApi(options.bearerToken!);
  }

  /**
   * Extracts the twitter handle from a twitter URL.
   */
  static extractHandle(url: string) {
    const split = url.split('/');
    return split[split.length - 1];
  }

  /**
   * Fetches all configured stream rule ids.
   */
  async getStreamRules() {
    const res = await this.api.v2.streamRules();
    const ids = res.data?.map((rule) => rule.id) ?? [];
    return ids;
  }

  /**
   * Dynamically build efficient stream rules by keeping in mind Twitter's API limits.
   *
   * Example resulting rule: `(from:sleeyax OR from:jfrazier) -is:retweet -is:reply -is:quote`
   */
  private buildRules(
    accounts: string[],
    accessLevel: AccessLevel = AccessLevel.Essential,
    filter: string = '-is:retweet -is:reply -is:quote'
  ): StreamingV2AddRulesParams {
    // TODO: check if there's a more performant (but also readable) way to do this...

    const placeholder = `() ${filter}`;
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

    if (rules.length > maxRules)
      console.warn(`Max number of stream rules reached (${rules.length}/${maxRules}). Twitter might complain about this!`);

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
    const rules = this.buildRules(accounts);
    const res = await this.api.v2.updateStreamRules(rules);
    return res.data;
  }

  /**
   * Remove all saved stream rules.
   *
   * The stream will become empty until we add accounts again.
   */
  async deleteStreamRules() {
    const ids = await this.getStreamRules();

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
  async streamTweets(onTweet: (tweet: TweetV2) => void) {
    const stream = await this.api.v2.searchStream({
      autoConnect: true
    });

    for await (const { data } of stream) {
      onTweet(data);
    }
  }
}
