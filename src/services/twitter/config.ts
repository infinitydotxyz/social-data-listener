/**
 * API access level.
 *
 * @link https://developer.twitter.com/en/docs/twitter-api/getting-started/about-twitter-api#v2-access-level
 */
export enum AccessLevel {
  Essential,
  Elevated,
  Academic
}

type TwitterConfig = {
  /**
   * API key.
   *
   * Think of the API key as the user name that represents your App when making API requests.
   * It helps Twitter verify who you are.
   */
  apiKey?: string;

  /**
   * API Key Secret.
   *
   * Your API Key Secret is like a password and helps verify your API Key.
   */
  apiKeySecret?: string;

  /**
   * Bearer Token.
   *
   * An Access Token used in authentication that allows you to pull specific data.
   */
  bearerToken?: string;

  accessToken?: string;

  accessTokenSecret?: string;
};

export default TwitterConfig;
