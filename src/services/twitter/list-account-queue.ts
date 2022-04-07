import { socialDataFirestoreConstants } from '../../constants';
import { firestore } from '../../container';
import { ListMember } from './twitter.types';

export default class ListAccountQueue {
  private accountRequestQueue: { resolve: (value: ListMember | PromiseLike<ListMember>) => void }[];
  private accountsQueue: ListMember[];

  constructor() {
    this.accountRequestQueue = [];
    this.accountsQueue = [];
    this.listenForAccounts();
  }

  public async getAccount(): Promise<ListMember> {
    const nextAccount = this.accountsQueue.shift();
    if (nextAccount) {
      return nextAccount;
    } else {
      return new Promise((resolve) => {
        this.accountRequestQueue.push({ resolve });
      });
    }
  }

  private listenForAccounts() {
    const accountsRef = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_LIST_MEMBERS_COLL);
    const accountsWaitingToBeAddedToList = accountsRef.where('addedToList', '==', 'queued');
    accountsWaitingToBeAddedToList.onSnapshot((snapshot) => {
      const changes = snapshot.docChanges();
      for (const change of changes) {
        switch (change.type) {
          case 'added':
            const accountConfig = change.doc.data() as ListMember;
            this.accountsQueue.push(accountConfig);
            break;
          case 'modified':
            const updated = change.doc.data() as ListMember;
            const index = this.accountsQueue.findIndex((account) => account.userId === updated.userId);
            if (index !== -1) {
              this.accountsQueue[index] = updated;
            }
            break;
          case 'removed':
            const removed = change.doc.data() as ListMember;
            this.accountsQueue.filter((item) => item.userId !== removed.userId);
            break;
        }
      }

      while (this.accountRequestQueue.length > 0 && this.accountsQueue.length > 0) {
        const request = this.accountRequestQueue.shift();
        const account = this.accountsQueue.shift();
        if (request && account) {
          request.resolve(account);
        } else if (request) {
          this.accountRequestQueue.unshift(request);
          break;
        } else if (account) {
          this.accountsQueue.unshift(account);
          break;
        }
      }
    });
  }
}
