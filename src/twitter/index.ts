import { TwitterApi, TwitterApiReadOnly } from 'twitter-api-v2';
import TwitterConfig from './config';

export default class Twitter {
  private api: TwitterApiReadOnly;

  constructor(options: TwitterConfig) {
    if (!options.apiKey || !options.apiKeySecret || !options.bearerToken)
      throw new Error('Missing API keys! Check your environment variables.');

    this.api = new TwitterApi({
      appKey: options.apiKey,
      appSecret: options.apiKeySecret
      // accessToken: options.bearerToken,
    }).readOnly;
  }

  /**
   * Fetches all configured stream rule ids.
   */
  private async getStreamRules() {
    const res = await this.api.v2.streamRules();
    const ids = res.data.map((rule) => rule.id);
    return ids;
  }

  /**
   * Extracts the twitter handle from a twitter URL.
   */
  static extractHandle(url: string) {
    const split = url.split('/');
    return split[split.length - 1];
  }

  /**
   * Set the twiter handles to watch for tweets.
   */
  async updateAccounts(accounts: string[]) {
    // TODO(sleeyax): handle (rate) limits
    await this.api.v2.updateStreamRules({
      add: [
        {
          value: accounts.map((account) => `from:${account} -is:retweet -is:reply`).join(' ')
        }
      ]
    });
  }

  /**
   * Remove all twitter handles from our vision.
   *
   * The stream will become empty until we add accounts again.
   */
  async deleteAccounts() {
    await this.api.v2.updateStreamRules({
      delete: {
        ids: await this.getStreamRules()
      }
    });
  }

  /**
   * Starts listening to a stream of tweets from all twitter users we have set in {@link updateAccounts}.
   */
  async streamTweets() {
    const stream = await this.api.v2.searchStream({
      autoConnect: true
    });
    for await (const { data } of stream) {
      console.log(data);
    }
  }
}
