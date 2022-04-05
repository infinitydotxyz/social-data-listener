export interface TwitterConfig {
  /**
   * the number of lists that each bot account can have
   */
  maxListsPerAccount: number;

  /**
   * the max number of accounts that can be members of a list
   */
  maxMembersPerList: number;
}

export interface BotAccountConfig {
  /**
   * TODO are these needed for monitoring tweets?
   * if so, make sure to adjust the validate method of BotAccount
   */
  /**
   * v1 api creds
   */
  apiKey: string;
  apiKeySecret: string;
  accessTokenV1: string;
  accessSecretV1: string;

  /**
   * v2 api creds
   */
  clientId: string;
  clientSecret: string;
  accessTokenV2: string;
  refreshTokenV2: string;
  refreshTokenValidUntil?: number;

  /**
   */
  username: string;

  id: string;

  /**
   * number of lists this account has
   */
  numLists: number;
}

export interface ListConfig {
  id: string;
  name: string;
  numMembers: number;
  cursor?: string;
  totalTweets?: number;
}

export interface CreateListResponseData {
  id: string;
  name: string;
}

export interface UserIdResponseData {
  id: string;
  username: string;
  name: string;
}

export interface BasicResponse<T> {
  data: T;
}

export interface Collection {
  chainId: string;
  address: string;
}

export interface ListMemberCollection extends Collection {
  addedAt: number;
}

export interface ListMember {
  userId: string;
  username: string;
  listId: string;
  listOwnerId: string;
  collections: Record<string, ListMemberCollection>;
}
