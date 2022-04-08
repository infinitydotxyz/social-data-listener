import { BotAccountConfig, ListConfig } from '../twitter.types';

export enum BotAccountEvent {
  Loaded = 'bot-account-loaded',
  ListLoaded = 'bot-account-list-loaded',
  ListDeleted = 'bot-account-list-deleted',
  SubscribedUser = 'bot-account-subscribed-user',
  UnsubscribedUser = 'bot-account-unsubscribed-user',
  Tweet = 'bot-account-tweet'
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

export type BotAccountEvents = BotAccountLoadedEvent | ListLoadedEvent | ListDeletedEvent;

export type BotAccountEventsType = {
  [BotAccountEvent.Loaded]: BotAccountLoadedEvent;
  [BotAccountEvent.ListLoaded]: ListLoadedEvent;
  [BotAccountEvent.ListDeleted]: ListDeletedEvent;
};
