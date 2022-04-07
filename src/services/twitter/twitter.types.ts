export interface TwitterConfig {
  /**
   * The number of lists that each bot account can have
   */
  maxListsPerAccount: number;

  /**
   * The max number of accounts that can be members of a list
   */
  maxMembersPerList: number;

  /**
   * The default tweet poll interval in ms
   */
  defaultTweetPollInterval: number;
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
  tweetPollInterval: number;
  mostRecentTweetId: string;
  totalTweets: number;
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

export type UserNotFoundError = {
  /**
   * The username that was not found
   */
  value: string;
  /**
   * Error message
   */
  detail: string;
  /**
   * Error title
   */
  title: 'Not Found Error' | string;
  /**
   * Resource type requested
   */
  resource_type: string;
  /**
   * Query parameter that caused the error
   */
  parameter: string;
  /**
   * Id the resource that caused the error
   */
  resource_id: string;
  /**
   * Link to the problem
   */
  type: string;
};

export interface BasicResponse<T, Error = any> {
  data: T;
  errors?: Error[];
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
  /**
   * Whether the user has been added to the list
   * starts as queued => pending => added
   * pending is used when the member is being added to a list
   */
  addedToList: 'added' | 'pending' | 'queued';
  pendingSince?: number;
  listId: string;
  listOwnerId: string;
  collections: Record<string, ListMemberCollection>;
}

export interface TwitterUser {
  id: string;
  location: string;
  verified: boolean;
  username: string;
  name: string;
  profile_image_url: string;
}

export interface Tweet {
  text: string;
  attachments: TweetAttachments;
  id: string;
  possibly_sensitive: boolean;
  source: string;
  author_id: string;
  lang: string;
  /**
   * "2022-03-27T20:19:03.000Z"
   */
  createdAt: string;
}

export interface TweetAttachments {
  /**
   * Id of the media item
   */
  media_keys: string[];
}

export interface TweetMedia {
  width: number;
  preview_image_url: string;
  type: 'video' | 'photo' | 'animated_gif';
  media_key: string;
  height: number;
}

export interface ListTweetsResponse {
  data: Tweet[];
  includes: {
    users: TwitterUser[];
    media: TweetMedia[];
  };
  meta: {
    result_count: number;
    next_token?: string;
  };
}
