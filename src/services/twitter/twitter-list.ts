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
    void this.monitorTweets();
  }

  private async monitorTweets() {
    await this.getTweets();
  }

  private async getTweets() {
    const response = await this._botAccount.client.getListTweets(this.config.id, ''); // TODO add cursor
    const tweets = response.data;
    // const media = response.includes.media;
    // const users = response.includes.users;
    // const meta = response.includes.meta;
    // const results = meta.results_count;
    // const cursor = meta.next_token;
    // console.log(response);

    /**
     * TODO handle tweets
     */
    // const batch = firestore.batch();
    // batch.update(this._docRef, {
    //   numTweets: firebaseAdmin.firestore.FieldValue.increment(results),
    //   cursor: cursor,
    // });
    // await batch.commit();
  }

  /**
   * returns the number of members in the list
   */
  public get size() {
    return this.config.numMembers;
  }

  public getCollectionKey(collection: Collection) {
    return `${collection.chainId}:${trimLowerCase(collection.address)}`;
  }

  /**
   * handle adding a collection to the list
   */
  public async onCollectionAddUsername(username: string, collection: Collection) {
    const member = await this.addMember(username);

    // add collection to user
    TwitterList.getMemberRef(member.userId).update({
      collections: {
        ...member.collections,
        [this.getCollectionKey(collection)]: {
          chainId: collection.chainId,
          address: trimLowerCase(collection.address),
          addedAt: Date.now()
        }
      }
    });
  }

  /**
   * handle deleting a collection from the list
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
      // remove user from list
      await this.removeMember(member);
    }
  }

  /**
   * remove a member from the twitter list
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
   * add member to the twitter list
   */
  private async addMember(username: string): Promise<ListMember> {
    const listId = this.config.id;
    const member = await this.getListMember(username);

    if (member.listId === this.config.id && member.listOwnerId === this._botAccount.config.username) {
      // user is already part of this list
      return member;
    } else if (member.listId && member.listOwnerId) {
      throw new Error('Attempted to add user to list that is already part of another list');
    }

    if (this.config.numMembers + 1 > this._twitterConfig.config.maxMembersPerList) {
      throw new Error('List is full');
    }

    const { isUserMember } = await this._botAccount.client.addListMember(listId, member.userId);

    if (!isUserMember) {
      throw new Error(`Failed to add user: ${member.userId} to list: ${listId}`);
    }

    member.listId = listId;
    member.listOwnerId = this._botAccount.config.username;

    // add user to listMembers collection
    const batch = firestore.batch();
    batch.set(TwitterList.getMemberRef(member.userId), member);
    batch.update(this._docRef, {
      numMembers: firebaseAdmin.firestore.FieldValue.increment(1)
    });

    await batch.commit();

    return member;
  }

  /**
   * get a list member object by username
   *
   * initializes the member if it doesn't exist
   */
  private async getListMember(username: string): Promise<ListMember> {
    const userSnap = await TwitterList.allMembersRef.where('username', '==', username).get();
    const existingUser = userSnap?.docs?.[0]?.data() as ListMember | undefined;
    if (existingUser?.username) {
      return existingUser as ListMember;
    }

    const response = await this._botAccount.client.getUser(username);

    if (!response?.id) {
      console.log(response);
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
