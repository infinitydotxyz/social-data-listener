import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import {
  ListConfig,
  Collection,
  ListMember,
  TwitterUser,
  TweetMedia,
  Tweet,
  TwitterTweetEventPreCollectionData
} from './twitter.types';
import { sleep, trimLowerCase } from '@infinityxyz/lib/utils';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { FeedEventType } from '@infinityxyz/lib/types/core/feed';

export class TwitterList extends ConfigListener<
  ListConfig,
  { docSnapshot: ListConfig; tweetEvent: TwitterTweetEventPreCollectionData }
> {
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

  public async removeMemberFromList(account: ListMember) {
    if (account.listId !== this.config.id) {
      throw new Error(`Attempted to remove user from list which user is not a member of`);
    }

    const { isUserMember } = await this._botAccount.client.removeListMember(this.config.id, account.userId);
    if (isUserMember) {
      throw new Error(`Failed to remove user from list`);
    }

    const batch = firestore.batch();
    batch.delete(TwitterList.getMemberRef(account.userId));
    batch.update(this._docRef, {
      numMembers: firebaseAdmin.firestore.FieldValue.increment(-1)
    });
    await batch.commit();
  }

  private async processTweets() {
    for (;;) {
      try {
        console.log(`Getting new Tweets: ${this.config.id}`);
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
    let tweetsEmitted = 0;
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
        const username = usersMap?.[tweet.author_id]?.username ?? '';
        const tweetMedia = tweet?.attachments?.media_keys.map((key: string) => mediaMap?.[key]) ?? [];
        const media = tweetMedia.pop();
        const user = usersMap?.[tweet.author_id];

        const event: TwitterTweetEventPreCollectionData = {
          type: FeedEventType.TwitterTweet,
          externalLink: this.getTweetLink(username, tweet.id),
          id: tweet.id,
          authorId: tweet.author_id,
          username: user.username ?? '',
          authorProfileImage: user.profile_image_url ?? '',
          authorName: user.name ?? '',
          authorVerified: user.verified ?? false,
          text: tweet.text,
          source: tweet.source,
          image: media?.preview_image_url ?? '',
          language: tweet.lang,
          isSensitive: tweet.possibly_sensitive,
          likes: 0,
          comments: 0,
          timestamp: new Date(tweet.created_at).getTime()
        };
        void this.emit('tweetEvent', event);
        tweetsEmitted += 1;
      }

      cursor = meta?.next_token ?? '';

      if (!cursor || !mostRecentTweetId) {
        shouldGetNextPage = false;
      }
    }

    await this._docRef.update({
      mostRecentTweetId: newMostRecentTweetId,
      totalTweets: firebaseAdmin.firestore.FieldValue.increment(tweetsEmitted)
    });
  }

  private getTweetLink(username: string, tweetId: string) {
    return `https://twitter.com/${username}/status/${tweetId}`;
  }
}
