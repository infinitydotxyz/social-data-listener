export interface TwitterConfig {
  /**
   * The number of lists that each bot account can have
   */
  maxListsPerAccount: number;

  /**
   * The max number of accounts that can be members of a list
   */
  maxMembersPerList: number;
}

export interface BotAccountConfig {
  /**
   * V1 api creds
   */
  apiKey: string; // Aka oauth_consumer_key
  apiKeySecret: string;
  accessTokenV1: string;
  accessSecretV1: string;

  /**
   * V2 api creds
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
   * Number of lists this account has
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
