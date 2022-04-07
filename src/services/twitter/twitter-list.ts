import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { ListConfig, Collection, ListMember } from './twitter.types';
import { trimLowerCase } from '@infinityxyz/lib/utils';
import firebaseAdmin from 'firebase-admin';
import { ConfigListener } from '../../models/config-listener.abstract';
import { firestore } from '../../container';
import { TwitterConfig } from './twitter-config';

export type Tweet = any;
export class TwitterList extends ConfigListener<ListConfig> {
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

  constructor(
    config: ListConfig,
    private _botAccount: BotAccount,
    private _twitterConfig: TwitterConfig,
    private _onTweet: (tweet: Tweet) => void
  ) {
    super(config, TwitterList.ref(_botAccount, config.id));
    this.monitorTweets();
  }

  private monitorTweets() {
    setInterval(async () => {
      try {
        console.log(`Getting list tweets`);
        await this.getTweets();
      } catch (err) {
        console.error('Failed to get tweets', err);
      }
    }, 60_000);
  }

  private async getTweets() {
    const response = await this._botAccount.client.getListTweets(this.config.id, ''); // TODO add cursor
    console.log(Date.now());
    console.log(JSON.stringify(response, null, 2));
    // const tweets = response.data;
    // const media = response.includes.media;
    // const users = response.includes.users;
    // const meta = response.includes.meta;
    // const results = meta.results_count;
    // const cursor = meta.next_token;
    // console.log(response);
    /**
     * TODO handle tweets
     */
    // Const batch = firestore.batch();
    // Batch.update(this._docRef, {
    //   NumTweets: firebaseAdmin.firestore.FieldValue.increment(results),
    //   Cursor: cursor,
    // });
    // Await batch.commit();
  }

  /**
   * Returns the number of members in the list
   */
  public get size() {
    return this.config.numMembers + this.pendingMembers.length;
  }

  public getCollectionKey(collection: Collection) {
    return `${collection.chainId}:${trimLowerCase(collection.address)}`;
  }

  /**
   * Handle adding a collection to the list
   */
  public async onCollectionAddUsername(username: string, collection: Collection) {
    const member = await this.addMember(username);

    // Add collection to user
    await TwitterList.getMemberRef(member.userId).set(
      {
        collections: {
          [`${this.getCollectionKey(collection)}`]: {
            chainId: collection.chainId,
            address: trimLowerCase(collection.address),
            addedAt: Date.now()
          }
        }
      },
      { mergeFields: [`collections.${this.getCollectionKey(collection)}`] }
    );
  }

  /**
   * Handle deleting a collection from the list
   */
  public async onCollectionRemoveUsername(username: string, collection: Collection) {
    const member = await this.getListMember(username);

    if (member.listId !== this.config.id || member.listOwnerId !== this._botAccount.config.username) {
      throw new Error('Attempted to remove user from list that is not part of this list');
    }

    const key = this.getCollectionKey(collection);
    if (member.collections[key]) {
      delete member.collections[key];
    }
    const collectionSubscribedToAccount = Object.keys(member.collections);
    const noCollectionSubscribed = collectionSubscribedToAccount.length === 0;

    if (noCollectionSubscribed) {
      // Remove user from list
      await this.removeMember(member);
    }
  }

  /**
   * Remove a member from the twitter list
   */
  private async removeMember(member: ListMember) {
    const { isUserMember } = await this._botAccount.client.removeListMember(member.listId, member.userId);

    if (isUserMember) {
      throw new Error(`Failed to remove user: ${member.userId} from list: ${member.listId}`);
    }

    const batch = firestore.batch();
    batch.delete(TwitterList.getMemberRef(member.userId));
    batch.update(this._docRef, {
      numMembers: firebaseAdmin.firestore.FieldValue.increment(-1)
    });
    await batch.commit();
  }

  /**
   * Add member to the twitter list
   */
  private pendingMembers: ListMember[] = [];
  private debouncedTimeout?: NodeJS.Timeout;
  private debouncedPromise?: Promise<void>;
  private async addMember(username: string): Promise<ListMember> {
    const listId = this.config.id;
    const member = await this.getListMember(username);

    if (member.listId === this.config.id && member.listOwnerId === this._botAccount.config.username) {
      // User is already part of this list
      return member;
    } else if (member.listId && member.listOwnerId) {
      throw new Error('Attempted to add user to list that is already part of another list');
    }

    if (this.config.numMembers + 1 > this._twitterConfig.config.maxMembersPerList) {
      throw new Error('List is full');
    }

    if (!this.debouncedTimeout) {
      this.debouncedPromise = new Promise((resolve, reject) => {
        this.debouncedTimeout = setTimeout(async () => {
          this.debouncedTimeout = undefined;
          const firstOneHundred = this.pendingMembers.splice(0, 100); // Remove the first 100 members from the pending list
          const pendingMembersCopy = firstOneHundred;
          try {
            const userIds = pendingMembersCopy.map((item) => item.userId);
            await this._botAccount.client.addListMembers(this.config.id, userIds);
            console.log(`Added: ${pendingMembersCopy.length} members to list: ${this.config.id}`);

            // Add user to listMembers collection
            const batch = firestore.batch();
            for (const member of pendingMembersCopy) {
              member.listId = listId;
              member.listOwnerId = this._botAccount.config.username;
              batch.set(TwitterList.getMemberRef(member.userId), member);
            }

            batch.update(this._docRef, {
              numMembers: firebaseAdmin.firestore.FieldValue.increment(pendingMembersCopy.length)
            });

            await batch.commit();
            resolve();
          } catch (err) {
            reject(err);
          }
        }, 60_000);
      });
    }

    this.pendingMembers.push(member);
    await this.debouncedPromise;

    return member;
  }

  /**
   * Get a list member object by username
   *
   * initializes the member if it doesn't exist
   */
  private async getListMember(username: string): Promise<ListMember> {
    const userSnap = await TwitterList.allMembersRef.where('username', '==', username).get();
    const existingUser = userSnap?.docs?.[0]?.data() as ListMember | undefined;
    if (existingUser?.username) {
      return existingUser;
    }

    // const response = await this._botAccount.client.getUser(username);
    const response = await this._botAccount.getUser(username);

    if (!response?.id) {
      throw new Error('Failed to get user id');
    }

    const newUser: ListMember = {
      userId: response.id,
      username,
      listId: '',
      listOwnerId: '',
      collections: {}
    };

    return newUser;
  }
}
