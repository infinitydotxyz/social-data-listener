import { ListConfig } from './services/twitter/twitter.types';

export const socialDataFirestoreConstants = {
  SOCIAL_DATA_LISTENER_COLL: 'socialDataListener',
  TWITTER_DOC: 'twitter',
  TWITTER_ACCOUNTS_COLL: 'accounts',
  TWITTER_ACCOUNT_LIST_COLL: 'twitterAccountLists',
  TWITTER_LIST_MEMBERS_COLL: 'twitterListMembers'
};

export const DEFAULT_TWEET_POLL_INTERVAL = 60_000;
