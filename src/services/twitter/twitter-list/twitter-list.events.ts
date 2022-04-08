import { ListMember, TwitterTweetEventPreCollectionData } from '../twitter.types';

export enum TwitterListEvent {
  NewTweet = 'new-tweet',
  MemberAdded = 'member-added',
  MemberRemoved = 'member-removed',
  PolledTweets = 'polled-tweets',
  ConfigUpdate = 'docSnapshot'
}

export interface ListEventType {
  type: TwitterListEvent;

  list: string;

  account: string;

  listSize: number;

  totalTweets: number;
}

export interface NewTweetEvent extends ListEventType {
  type: TwitterListEvent.NewTweet;

  tweet: TwitterTweetEventPreCollectionData;
}

export interface MemberEvent extends ListEventType {
  member: ListMember;
}

export interface MemberAddedEvent extends MemberEvent {
  type: TwitterListEvent.MemberAdded;
}

export interface MemberRemovedEvent extends MemberEvent {
  type: TwitterListEvent.MemberRemoved;
}

export interface PolledTweetsEvent extends ListEventType {
  type: TwitterListEvent.PolledTweets;

  newTweetsFound: number;

  tweetsPolled: number;

  pagesPolled: number;
}

export type ListEvent = NewTweetEvent | MemberAddedEvent | MemberRemovedEvent | PolledTweetsEvent;
