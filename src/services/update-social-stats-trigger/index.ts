import Listener from '../listener';
import schedule from 'node-schedule';
import { OrderDirection } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils/constants';
import fetch from 'node-fetch';
import { MAIN_API_URL } from '../../constants';

const UPDATE_SOCIAL_STATS_ENDPOINT = `${MAIN_API_URL}/collections/update-social-stats?list=`;
const TRIGGER_TIMER = 1000; // every 1s
const PAGE_SIZE = 100; // pagination

type DocItem = {
  address: string;
};
function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
export class UpdateSocialStatsTrigger extends Listener<unknown> {
  constructor({}, db: FirebaseFirestore.Firestore) {
    super(db);
  }

  async setup() {}

  async monitor(handler?: unknown) {
    console.log(`Started UpdateSocialStatsTrigger`);
    this.run();

    // runs every 12 hours
    const job = schedule.scheduleJob('UpdateSocialStatsTrigger', '0 */12 * * *', async () => {
      console.log(`Scheduled job [${job.name}] started at ${job.nextInvocation().toISOString()}`);
      this.run();
    });
  }

  async run() {
    const collectionRef = this.db.collection(firestoreConstants.COLLECTIONS_COLL);

    let query = collectionRef.select('address').orderBy(
      '__name__',
      OrderDirection.Ascending // orderBy is required to support pagination
    ) as FirebaseFirestore.Query<DocItem>;

    const getStartAfterField = (ref: FirebaseFirestore.DocumentReference) => {
      return [ref.id];
    };

    let hasNextPage = true;
    let startAfter: (string | number)[] | undefined = undefined;

    let count = 0;
    while (hasNextPage) {
      if (startAfter !== undefined) {
        query = query.startAfter(...startAfter);
      }
      const result = await query.limit(PAGE_SIZE).get();
      hasNextPage = result.docs.length === PAGE_SIZE;
      startAfter = getStartAfterField(result.docs[result.docs.length - 1].ref);
      console.log('UpdateSocialStatsTrigger collections updated:', count);

      for (const doc of result.docs) {
        const docData = doc.data() as DocItem;
        if (docData.address) {
          fetch(`${UPDATE_SOCIAL_STATS_ENDPOINT}${docData.address}`)
            .then(() => {
              // console.log('/update-social-stats', docData.address);
              count++;
            })
            .catch((err: any) => console.error(err));
          await sleep(TRIGGER_TIMER);
        }
      }
    }
    console.log('UpdateSocialStatsTrigger - Total collections updated:', count);
  }
}
