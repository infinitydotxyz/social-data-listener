import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { ListConfig, Collection, ListMember, TwitterUser, TweetMedia } from './twitter.types';
import { sleep, trimLowerCase } from '@infinityxyz/lib/utils';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';

export type Tweet = any;

export class TwitterList extends ConfigListener<ListConfig, { docSnapshot: ListConfig; tweetEvent: TwitterTweetEvent }> {
  static ref(botAccount: BotAccount, listId: string): FirebaseFirestore.DocumentReference<ListConfig> {
    const botAccountRef = BotAccount.ref(botAccount.config.username);
    const listRef = botAccountRef.collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL).doc(listId);
    return listRef as FirebaseFirestore.DocumentReference<ListConfig>;
  }

  static get allMembersRef(): FirebaseFirestore.CollectionReference {
    return firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_LIST_MEMBERS_COLL);
  }

  static getMemberRef(userId: string): FirebaseFirestore.DocumentReference<ListMember> {
    return this.allMembersRef.doc(userId) as FirebaseFirestore.DocumentReference<ListMember>;
  }

  constructor(config: ListConfig, private _botAccount: BotAccount) {
    super(config, TwitterList.ref(_botAccount, config.id));
    void this.processTweets();
  }

  /**
   * Returns the number of members in the list
   */
  public get size() {
    return this.config.numMembers;
  }

  public getCollectionKey(collection: Collection) {
    return `${collection.chainId}:${trimLowerCase(collection.address)}`;
  }

  public async addMemberToList(account: ListMember) {
    console.log(`Adding member ${account.username} ${account.userId} to list ${this.config.id}`);
    const claimedAccount: ListMember = {
      ...account,
      addedToList: 'pending',
      pendingSince: Date.now()
    };
    await TwitterList.getMemberRef(account.userId).set(claimedAccount);

    const { isUserMember } = await this._botAccount.client.addListMember(this.config.id, account.userId);

    const updatedAccount: ListMember = {
      ...account,
      addedToList: isUserMember ? 'added' : 'queued',
      listId: isUserMember ? this.config.id : '',
      listOwnerId: isUserMember ? this._botAccount.config.id : ''
    };

    const batch = firestore.batch();
    batch.set(TwitterList.getMemberRef(account.userId), updatedAccount);
    batch.update(this._docRef, {
      numMembers: firebaseAdmin.firestore.FieldValue.increment(1)
    });
    await batch.commit();
  }

  private async processTweets() {
    for (;;) {
      try {
        await this.getNewTweets();
      } catch (err) {
        console.error('Failed to get tweets', err);
      }
      await sleep(this.config.tweetPollInterval);
    }
  }

  private async getNewTweets() {
    const mostRecentTweetId = this.config.mostRecentTweetId;
    let newMostRecentTweetId = '';
    let shouldGetNextPage = true;
    let page = 0;
    const MAX_PAGES = 8; // Api is limited to 8 pages
    let cursor = '';
    while (shouldGetNextPage && page < MAX_PAGES) {
      page += 1;
      const response = await this._botAccount.client.getListTweets(this.config.id, cursor);
      const tweets: Tweet[] = response?.data ?? [];
      const users: TwitterUser[] = response?.includes?.users ?? [];
      const usersMap = users.reduce(
        (acc: Record<string, TwitterUser>, user: TwitterUser) => ({
          ...acc,
          [user.id]: user
        }),
        {}
      );

      const media: TweetMedia[] = response?.includes?.media ?? [];
      const mediaMap = media.reduce(
        (acc: Record<string, TweetMedia>, media: TweetMedia) => ({
          ...acc,
          [media.media_key]: media
        }),
        {}
      );

      const meta = response?.meta;

      if (!cursor) {
        newMostRecentTweetId = tweets[0]?.id ?? '';
      }

      for (const tweet of tweets) {
        if (tweet.id === mostRecentTweetId) {
          shouldGetNextPage = false;
          break;
        }
        if (tweet.text.startsWith('RT @')) {
          // Ignore retweets
          continue;
        }

        const event: TwitterTweetEvent = {
          type: FeedEventType.TwitterTweet,
          id: tweet.id,
          authorId: tweet.author_id,
          text: tweet.text,
          source: tweet.source,
          image: mediaMap?.[tweet.media_key]?.preview_image_url ?? '',
          language: tweet.lang,
          isSensitive: tweet.possibly_sensitive,
          username: usersMap?.[tweet.author_id]?.username ?? '',
          likes: 0,
          comments: 0,
          timestamp: new Date(tweet.created_at).getTime()
        };
        void this.emit('tweetEvent', event);
      }

      cursor = meta?.next_token ?? '';

      if (!cursor || !mostRecentTweetId) {
        shouldGetNextPage = false;
      }
    }
    await this._docRef.update({ mostRecentTweetId: newMostRecentTweetId });
  }
}
