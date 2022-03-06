type TwitterConfig = {
  /**
   * API key.
   *
   * Think of the API key as the user name that represents your App when making API requests.
   * It helps Tiwtter verify who you are.
   */
  apiKey: string;

  /**
   * API Key Secret.
   *
   * Your API Key Secret is like a password and helps verify your API Key.
   */
  apiKeySecret: string;

  /**
   * Bearer Token.
   *
   * An Access Token used in authentication that allows you to pull specific data.
   */
  bearerToken: string;
};

export default TwitterConfig;
