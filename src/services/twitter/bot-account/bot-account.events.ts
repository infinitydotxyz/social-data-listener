import { TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { BotAccountConfig, ListConfig } from '../twitter.types';

export enum BotAccountEvent {
  Loaded = 'loaded',
  ListLoaded = 'list-loaded',
  ListDeleted = 'list-deleted',
  SubscribedUser = 'subscribed-user',
  UnsubscribedUser = 'unsubscribed-user',
  Tweet = 'tweet'
}

export interface BotAccountEventType {
  type: BotAccountEvent;

  account: string;

  numLists: number;

  totalTweets: number;
}

export interface BotAccountLoadedEvent extends BotAccountEventType {
  type: BotAccountEvent.Loaded;

  config: BotAccountConfig;
}

export interface ListLoadedEvent extends BotAccountEventType {
  type: BotAccountEvent.ListLoaded;

  list: ListConfig;
}

export interface ListDeletedEvent extends BotAccountEventType {
  type: BotAccountEvent.ListDeleted;
  list?: ListConfig;
}

export interface TweetEvent extends BotAccountEventType {
  type: BotAccountEvent.Tweet;

  tweet: TwitterTweetEvent;
}

export type BotAccountEvents = BotAccountLoadedEvent | ListLoadedEvent | ListDeletedEvent | TweetEvent;

export type BotAccountEventsType = {
  [BotAccountEvent.Loaded]: BotAccountLoadedEvent;
  [BotAccountEvent.ListLoaded]: ListLoadedEvent;
  [BotAccountEvent.ListDeleted]: ListDeletedEvent;
  [BotAccountEvent.Tweet]: TweetEvent;
};
