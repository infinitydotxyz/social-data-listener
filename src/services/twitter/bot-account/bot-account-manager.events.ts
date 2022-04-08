import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { Collection } from '../twitter.types';

export enum BotAccountManagerEvent {
  Subscription = 'bot-account-manager-collection-subscribed',
  ErroredSubscription = 'bot-account-manager-collection-subscription-errored',
  UnSubscription = 'bot-account-manager-collection-unsubscribed',
  Tweet = 'bot-account-manager-tweet'
}

export enum SubscriptionError {
  InvalidUsername = 'invalid-username',
  UserSuspended = 'user-suspended',
  Unknown = 'unknown'
}

export interface BotAccountManagerEventType {
  type: BotAccountManagerEvent;

  accounts: number;

  lists: number;

  totalTweets: number;
}

export interface SubscriptionEvent extends BotAccountManagerEventType {
  type: BotAccountManagerEvent.Subscription;

  username: string;

  collection: Collection;

  existingUserSubscriptions?: string;
}

export interface UnSubscriptionEvent extends BotAccountManagerEventType {
  type: BotAccountManagerEvent.UnSubscription;

  username: string;

  collection: Collection;

  subscriptionsRemaining: string;
}

export interface ErroredSubscriptionEvent extends BotAccountManagerEventType {
  type: BotAccountManagerEvent.ErroredSubscription;

  username: string;

  collection: Collection;

  reason: SubscriptionError;

  error: string;
}

export interface TweetEvent extends BotAccountManagerEventType {
  type: BotAccountManagerEvent.Tweet;

  tweet: TwitterTweetEvent;
}

export type BotAccountManagerEvents = SubscriptionEvent | UnSubscriptionEvent | TweetEvent | ErroredSubscriptionEvent;

export type BotAccountManagerEventsType = {
  [BotAccountManagerEvent.Subscription]: SubscriptionEvent;
  [BotAccountManagerEvent.UnSubscription]: UnSubscriptionEvent;
  [BotAccountManagerEvent.Tweet]: TweetEvent;
  [BotAccountManagerEvent.ErroredSubscription]: ErroredSubscriptionEvent;
};
