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
    // Const tweets = response.data;
    // Const media = response.includes.media;
    // Const users = response.includes.users;
    // Const meta = response.includes.meta;
    // Const results = meta.results_count;
    // Const cursor = meta.next_token;
    // Console.log(response);
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

  // /**
  //  * Handle deleting a collection from the list
  //  */
  // public async onCollectionRemoveUsername(username: string, collection: Collection) {
  //   const member = await this.getListMember(username);

  //   if (member.listId !== this.config.id || member.listOwnerId !== this._botAccount.config.username) {
  //     throw new Error('Attempted to remove user from list that is not part of this list');
  //   }

  //   const key = this.getCollectionKey(collection);
  //   if (member.collections[key]) {
  //     delete member.collections[key];
  //   }
  //   const collectionSubscribedToAccount = Object.keys(member.collections);
  //   const noCollectionSubscribed = collectionSubscribedToAccount.length === 0;

  //   if (noCollectionSubscribed) {
  //     // Remove user from list
  //     await this.removeMember(member);
  //   }
  // }

  // /**
  //  * Remove a member from the twitter list
  //  */
  // private async removeMember(member: ListMember) {
  //   const { isUserMember } = await this._botAccount.client.removeListMember(member.listId, member.userId);

  //   if (isUserMember) {
  //     throw new Error(`Failed to remove user: ${member.userId} from list: ${member.listId}`);
  //   }

  //   const batch = firestore.batch();
  //   batch.delete(TwitterList.getMemberRef(member.userId));
  //   batch.update(this._docRef, {
  //     numMembers: firebaseAdmin.firestore.FieldValue.increment(-1)
  //   });
  //   await batch.commit();
  // }

  // /**
  //  * Add member to the twitter list
  //  */
  // private async addMember(username: string): Promise<ListMember> {
  //   const member = await this.getListMember(username);

  //   if (member.listId === this.config.id && member.listOwnerId === this._botAccount.config.username) {
  //     // User is already part of this list
  //     return member;
  //   } else if (member.listId && member.listOwnerId) {
  //     throw new Error('Attempted to add user to list that is already part of another list');
  //   }

  //   const updatedMember = await this._addMemberDebouncer.enqueue(member.userId, member);

  //   return updatedMember;
  // }

  //   If (this.config.numMembers + 1 > this._twitterConfig.config.maxMembersPerList) {
  //     Throw new Error('List is full');
  //   }

  //   If (!this.debouncedTimeout) {
  //     This.debouncedPromise = new Promise((resolve, reject) => {
  //       This.debouncedTimeout = setTimeout(async () => {
  //         This.debouncedTimeout = undefined;
  //         Const firstOneHundred = this.pendingMembers.splice(0, 100); // Remove the first 100 members from the pending list
  //         Const pendingMembersCopy = firstOneHundred;
  //         Try {
  //           Const userIds = pendingMembersCopy.map((item) => item.userId);
  //           Await this._botAccount.client.addListMembers(this.config.id, userIds);
  //           Console.log(`Added: ${pendingMembersCopy.length} members to list: ${this.config.id}`);

  //           // Add user to listMembers collection
  //           Const batch = firestore.batch();
  //           For (const member of pendingMembersCopy) {
  //             Member.listId = listId;
  //             Member.listOwnerId = this._botAccount.config.username;
  //             Batch.set(TwitterList.getMemberRef(member.userId), member);
  //           }

  //           Batch.update(this._docRef, {
  //             NumMembers: firebaseAdmin.firestore.FieldValue.increment(pendingMembersCopy.length)
  //           });

  //           Await batch.commit();
  //           Resolve();
  //         } catch (err) {
  //           Reject(err);
  //         }
  //       }, 60_000);
  //     });
  //   }

  //   This.pendingMembers.push(member);
  //   Await this.debouncedPromise;

  //   Return member;
  // }

  // private getAddMemberDebouncer() {
  //   type HandlerReturn = Array<{ id: string; output: ListMember } | { id: string; error: Error }>;
  //   const handler = async (inputs: { id: string; value: ListMember }[]): Promise<HandlerReturn> => {
  //     const screenNames = inputs.map((item) => item.value.username);
  //     await this._botAccount.client.addListMembers(this.config.id, screenNames);
  //     console.log(`Added: ${screenNames.length} members to list: ${this.config.id}`);

  //     // Add user to listMembers collection
  //     const batch = firestore.batch();
  //     for (const input of inputs) {
  //       input.value.listId = this.config.id;
  //       input.value.listOwnerId = this._botAccount.config.username;
  //       batch.set(TwitterList.getMemberRef(input.value.userId), input.value, { merge: true });
  //     }

  //     batch.update(this._docRef, {
  //       numMembers: firebaseAdmin.firestore.FieldValue.increment(inputs.length)
  //     });

  //     await batch.commit();

  //     return inputs.map((item) => ({ id: item.id, output: item.value }));
  //   };

  //   const debouncer = new BatchDebouncer({ timeout: 60_000, maxBatchSize: 100 }, handler);
  //   return debouncer;
  // }

  // /**
  //  * Get a list member object by username
  //  *
  //  * initializes the member if it doesn't exist
  //  */
  // private async getListMember(username: string): Promise<ListMember> {
  //   const userSnap = await TwitterList.allMembersRef.where('username', '==', username).get();
  //   const existingUser = userSnap?.docs?.[0]?.data() as ListMember | undefined;
  //   if (existingUser?.username) {
  //     return existingUser;
  //   }

  //   const response = await this._botAccount.getUser(username);

  //   if (!response?.id) {
  //     throw new Error('Failed to get user id');
  //   }

  //   const newUser: ListMember = {
  //     userId: response.id,
  //     username,
  //     listId: '',
  //     listOwnerId: '',
  //     collections: {}
  //   };

  //   return newUser;
  // }
}
