export interface TwitterListenerConfig {
  /**
   * the number of lists that each bot account can have
   */
  maxListsPerAccount: number;

  /**
   * the max number of accounts that can be members of a list
   */
  maxAccountsPerList: number;
}

export interface BotAccountConfig {
  apiKey: string;
  apiKeySecret: string;
  bearerToken: string;
  clientId: string;
  clientSecret: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  refreshTokenValidUntil?: number;

  /**
   * number of lists this account has
   */
  numLists: number;
}

export interface BotAccountList {
  id: string;
  name: string;
  numMembers: number;
}

export interface CreateListResponseData {
  id: string;
  name: string;
}

export interface BasicResponse<T> {
  data: T;
}
