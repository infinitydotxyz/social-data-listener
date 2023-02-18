import { BaseCollection } from '@infinityxyz/lib/types/core';
import { EventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { StreamingV2AddRulesParams, TweetV2SingleStreamResult, TwitterApi } from 'twitter-api-v2';
import Listener, { OnEvent } from '../listener';
import TwitterConfig, { AccessLevel } from './config';
import { ruleLengthLimitations, ruleLimitations } from './limitations';

export class Twitter extends Listener<TwitterTweetEvent> {
  private api: TwitterApi;

  private handlesInStream: Set<string> = new Set();

  constructor(options: TwitterConfig, db: FirebaseFirestore.Firestore) {
    super(db);
    if (!options.bearerToken) throw new Error('Bearer token must be set!');
    this.api = new TwitterApi(options.bearerToken);
  }

  async setup(): Promise<void> {
    const query = this.db.collection(firestoreConstants.SUPPORTED_COLLECTIONS_COLL).where('isSupported', '==', true).limit(1000); // future-todo: remove limit once we support more colls

    await this.deleteStreamRules();
    this.handlesInStream = new Set();

    return new Promise((resolve, reject) => {
      const unsubscribe = query.onSnapshot(async (snapshot) => {
        try {
          const changes = snapshot.docChanges();

          const twitterHandlesAdded = changes
            .filter(
              (change) => change.type === 'added' && change.doc.data().metadata?.links?.twitter && change.doc.data().isSupported
            )
            .map((change) => Twitter.extractHandle(change.doc.data().metadata.links.twitter))
            .filter((handle) => !!handle.trim())
            .filter((handle) => !this.handlesInStream.has(handle));

          // future-TODO: properly handle 'modified' and 'removed' documents.
          // The problem is that we can't exactly delete or modify one exact rule because atm one rule monitors multiple accounts.
          // We might be able to get around this limitation once we can apply many more (and preferably unlimited) rules per twitter handle via some kind of commercial API access.
          // For the time being, we just inefficiently re-create the rule from scratch whenever a document is deleted or modified (only when twitter url changed).
          if (
            changes.some(
              (change) =>
                (change.type === 'modified' &&
                  !snapshot.docs.some(
                    (old) => old.data().metadata?.links?.twitter === change.doc.data().metadata?.links?.twitter
                  )) ||
                change.type === 'removed'
            )
          ) {
            console.log(`Resetting twitter streaming API rules (document modified or deleted)`);
            unsubscribe();
            return this.setup();
          }

          if (twitterHandlesAdded.length) {
            console.log(`Monitoring ${twitterHandlesAdded.length} new twitter handles`);
            await this.updateStreamRules(twitterHandlesAdded);
            for (const handle of twitterHandlesAdded) {
              this.handlesInStream.add(handle);
            }
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Extracts the twitter handle from a twitter URL.
   */
  static extractHandle(url: string) {
    const split = url.replace(/\/+$/, '').split('/');
    return split[split.length - 1].replace('@', '');
  }

  /**
   * Appends a twitter handle to the twitter URL.
   */
  static appendHandle(handle: string) {
    return 'https://twitter.com/' + handle;
  }

  /**
   * Fetches all configured stream rule ids.
   */
  async getStreamRuleIds() {
    const rules = await this.getStreamRules();
    const ids = rules.map((rule) => rule.id);
    return ids;
  }

  /**
   * Fetches all configured stream rules.
   */
  async getStreamRules() {
    const res = await this.api.v2.streamRules();
    return res.data ?? [];
  }

  /**
   * Dynamically build efficient stream rules by keeping in mind Twitter's API limits.
   *
   * Example resulting rule: `(from:sleeyax OR from:jfrazier) -is:retweet -is:reply -is:quote`
   */
  buildStreamRules(
    accounts: string[],
    accessLevel: AccessLevel = AccessLevel.Essential,
    filter: string = '-is:retweet -is:reply -is:quote'
  ): StreamingV2AddRulesParams {
    const placeholder = `()${filter.length ? ' ' + filter : ''}`;
    const concatenator = ' OR ';
    const rules: Array<{ value: string }> = [];
    const maxRules = ruleLimitations[accessLevel];
    const maxRuleLength = ruleLengthLimitations[accessLevel];

    let offset = 0;
    let fromAccounts = accounts.map((account) => 'from:' + account);
    for (let i = 1; i <= fromAccounts.length; i++) {
      const slice = fromAccounts.slice(offset, i);
      const current = slice.join(concatenator);

      if (placeholder.replace('()', `(${current})`).length > maxRuleLength) {
        // set offset to the current end index.
        // this will make sure that, on the next iteration of the loop, we start with the item that we're now excluding.
        offset = i - 1;
        // push the joined slice w/o the last item (which would exceed the max rule length otherwise) to the rules array
        const previous = slice.slice(0, slice.length - 1).join(concatenator);
        rules.push({ value: placeholder.replace('()', `(${previous})`) });
      }
    }

    // push any remaining rules
    if (offset < fromAccounts.length)
      rules.push({ value: placeholder.replace('()', `(${fromAccounts.slice(offset, fromAccounts.length).join(concatenator)})`) });

    if (rules.length > maxRules) {
      console.warn(
        `Max number of stream rules reached (${rules.length}/${maxRules}). Rules that exceed this limit will be stripped to avoid API errors!`
      );
      return {
        add: rules.slice(0, maxRules)
      };
    }

    return {
      add: rules
    };
  }

  /**
   * Set the twitter handles to watch for tweets.
   *
   * Please beware of rate limits! See link.
   *
   * @link https://developer.twitter.com/en/docs/twitter-api/tweets/filtered-stream/introduction
   */
  async updateStreamRules(accounts: string[]) {
    const rules = this.buildStreamRules(accounts);
    const res = await this.api.v2.updateStreamRules(rules);
    if (res.errors?.length) {
      console.error(res.errors);
      throw new Error('Failed to update stream rules. See the API error above.');
    }
    return res.data;
  }

  /**
   * Remove all saved stream rules.
   *
   * The stream will become empty until we add accounts again.
   */
  async deleteStreamRules() {
    const ids = await this.getStreamRuleIds();

    if (ids.length == 0) return;

    const res = await this.api.v2.updateStreamRules({
      delete: {
        ids
      }
    });

    return res.meta;
  }

  /**
   * Starts listening to a stream of tweets from all twitter users we have set in {@link updateStreamRules}.
   */
  private async streamTweets(onTweet: (tweet: TweetV2SingleStreamResult) => void) {
    const stream = await this.api.v2.searchStream({
      autoConnect: true,
      expansions: 'author_id,attachments.media_keys',
      'tweet.fields': 'author_id,created_at,id,lang,possibly_sensitive,source,text',
      'user.fields': 'location,name,profile_image_url,username,verified',
      'media.fields': 'height,width,preview_image_url,type,url,alt_text'
    });

    for await (const item of stream) {
      onTweet(item);
    }
  }

  monitor(handler: OnEvent<TwitterTweetEvent>): void {
    this.streamTweets(async (tweet) => {
      console.log('Received tweet from', tweet.includes?.users?.[0]?.username, tweet.data.text);
      try {
        const media = tweet.includes?.media?.[0];
        const user = tweet.includes?.users?.[0];
        const username = (user?.username ?? '').toLowerCase();
        const collRef = this.db.collection(firestoreConstants.COLLECTIONS_COLL);
        const event: TwitterTweetEvent = {
          id: tweet.data.id,
          type: EventType.TwitterTweet,
          authorId: tweet.data.author_id || '',
          authorProfileImage: user?.profile_image_url || '',
          authorName: user?.name || user?.username || '',
          authorVerified: !!user?.verified,
          chainId: '1',
          collectionAddress: '',
          collectionName: '',
          collectionSlug: '',
          collectionProfileImage: '',
          externalLink: media?.url || '',
          hasBlueCheck: false,
          internalUrl: '',
          comments: 0,
          likes: 0,
          isSensitive: !!tweet.data.possibly_sensitive,
          language: tweet.data.lang ?? '',
          timestamp: new Date(tweet.data.created_at ?? new Date()).getTime(),
          image: media?.url ?? '',
          source: tweet.data.source ?? '',
          text: tweet.data.text ?? '',
          username: username
        };

        if (username) {
          let query = collRef.where('metadata.links.twitter', '==', Twitter.appendHandle(username));

          let snapshot = await query.where('hasBlueCheck', '==', true).limit(1).get();
          if (snapshot.size === 0) {
            snapshot = await query.limit(1).get();
          }

          const doc = snapshot.docs[0];

          if (doc) {
            const data = doc.data() as BaseCollection;
            if (data) {
              console.log('Writing tweet to feed for collection', data.chainId, data.metadata?.name, data.address);
              handler({
                ...event,
                collectionAddress: data.address ?? '',
                collectionName: data.metadata?.name ?? '',
                collectionSlug: data.slug ?? '',
                collectionProfileImage: data.metadata?.profileImage,
                chainId: data.chainId,
                hasBlueCheck: data.hasBlueCheck ?? false
              });
            } else {
              console.warn('No collection data found for twitter username', username);
            }
          } else {
            console.warn('No collection record found for twitter username', username);
          }
        }
      } catch (err) {
        console.error(err);
      }
    });
  }
}
