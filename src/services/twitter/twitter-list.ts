import { socialDataFirestoreConstants } from '../../constants';
import { BotAccount } from './bot-account';
import { BotAccountListConfig, Collection, ListMember } from './twitter.types';
import { trimLowerCase } from '@infinityxyz/lib/utils';
import firebaseAdmin from 'firebase-admin';

export class TwitterList {
  private _setupMutex = false;

  constructor(private _config: BotAccountListConfig, private _botAccount: BotAccount, private _db: FirebaseFirestore.Firestore) {
    this.setup();
  }

  /**
   * returns the number of members in the list
   */
  public get size() {
    return this._config.numMembers;
  }

  public getCollectionKey(collection: Collection) {
    return `${collection.chainId}-${trimLowerCase(collection.address)}`;
  }

  /**
   * handle adding a collection to the list
   */
  public async onCollectionAddUsername(username: string, collection: Collection) {
    if (this._config.numMembers + 1 > this._botAccount.twitterListenerConfig.maxAccountsPerList) {
      throw new Error('List is full');
    }

    const member = await this.addMember(username);

    // add collection to user
    this._allListMembersRef.doc(member.userId).update({
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

    const key = this.getCollectionKey(collection);
    if (member.collections[key]) {
      delete member.collections[key];
    }

    if (Object.keys(member.collections).length === 0) {
      // remove user from list
      await this.removeMember(member);
    }
  }

  private get listRef(): FirebaseFirestore.DocumentReference<BotAccountListConfig> {
    return this._botAccount.accountRef
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNT_LIST_COLL)
      .doc(this._config.id) as any;
  }

  private get _allListMembersRef() {
    return this._db
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_LIST_MEMBERS_COLL);
  }

  /**
   * remove a member from the twitter list
   */
  private async removeMember(member: ListMember) {
    const response = await this._botAccount.client.v2.removeListMember(member.listId, member.userId);
    const successful = response.data.is_member === false;

    if (successful) {
      const batch = this._db.batch();
      batch.delete(this._allListMembersRef.doc(member.userId));
      batch.update(this.listRef, {
        numMembers: firebaseAdmin.firestore.FieldValue.increment(-1)
      });
      await batch.commit();
    }
  }

  /**
   * add member to the twitter list
   */
  private async addMember(username: string): Promise<ListMember> {
    const listId = this._config.id;
    const member = await this.getListMember(username);

    if (member.listId && member.listOwnerId) {
      // user is already part of a list
      return member;
    }

    const response = await this._botAccount.client.v2.addListMember(listId, member.userId);
    const successful = response.data.is_member;
    if (!successful) {
      throw new Error('Failed to add user to list');
    }

    member.listId = listId;
    member.listOwnerId = this._botAccount.botAccountId;

    // add user to listMembers collection
    const batch = this._db.batch();
    batch.set(this._allListMembersRef.doc(member.userId), member);
    batch.update(this.listRef, {
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
    const userSnap = await this._allListMembersRef.where('username', '==', username).get();
    const existingUser = userSnap?.docs?.[0]?.data();
    if (existingUser?.id) {
      return existingUser as ListMember;
    }

    const response = await this._botAccount.getUser(username);

    if (!response.id) {
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

  /**
   * setup the list to stay in sync with the database
   */
  private setup() {
    this.checkMutex();
    this.listenForConfigChanges();
    this._setupMutex = true;
  }

  private checkMutex() {
    if (this._setupMutex) {
      throw new Error('This method is not allowed to be called after setup()');
    }
    return;
  }

  private listenForConfigChanges() {
    this.checkMutex();
    this.listRef.onSnapshot((snapshot) => {
      const data = snapshot.data() as BotAccountListConfig;
      this._config = data;
    });
  }
}
