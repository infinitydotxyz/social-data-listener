import { ListMember, TwitterTweetEventPreCollectionData } from '../twitter.types';

export enum TwitterListEvent {
  NewTweet = 'twitter-list-new-tweet',
  MemberAdded = 'twitter-list-member-added',
  MemberRemoved = 'twitter-list-member-removed',
  PolledTweets = 'twitter-list-polled-tweets'
}

export interface TwitterListEventType {
  type: TwitterListEvent;

  list: string;

  account: string;

  listSize: number;

  totalTweets: number;
}

export interface NewTweetEvent extends TwitterListEventType {
  type: TwitterListEvent.NewTweet;

  tweet: TwitterTweetEventPreCollectionData;
}

export interface MemberEvent extends TwitterListEventType {
  member: ListMember;
}

export interface MemberAddedEvent extends MemberEvent {
  type: TwitterListEvent.MemberAdded;
}

export interface MemberRemovedEvent extends MemberEvent {
  type: TwitterListEvent.MemberRemoved;
}

export interface PolledTweetsEvent extends TwitterListEventType {
  type: TwitterListEvent.PolledTweets;

  newTweetsFound: number;

  tweetsPolled: number;

  pagesPolled: number;
}

export type TwitterListEvents = NewTweetEvent | MemberAddedEvent | MemberRemovedEvent | PolledTweetsEvent;

export type TwitterListsEventsType = {
  [TwitterListEvent.NewTweet]: NewTweetEvent;
  [TwitterListEvent.MemberAdded]: MemberAddedEvent;
  [TwitterListEvent.MemberRemoved]: MemberRemovedEvent;
  [TwitterListEvent.PolledTweets]: PolledTweetsEvent;
};
