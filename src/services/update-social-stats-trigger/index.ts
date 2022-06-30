import Listener from '../listener';
import schedule from 'node-schedule';
import { OrderDirection, StatsPeriod } from '@infinityxyz/lib/types/core';
import { firestoreConstants, TRENDING_COLLS_TTS } from '@infinityxyz/lib/utils/constants';
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
    // first update trending collections
    await this.updateTrendingCollections();

    // then update everything else
    const collectionRef = this.db.collection(firestoreConstants.COLLECTIONS_COLL);
    let query = collectionRef.select('address').orderBy(
      'address',
      OrderDirection.Ascending // orderBy is required to support pagination
    ) as FirebaseFirestore.Query<DocItem>;

    let hasNextPage = true;
    let startAfter = '';

    let count = 0;
    while (hasNextPage) {
      try {
        console.log('Updating social stats for', PAGE_SIZE, 'collections', 'starting after', startAfter);
        if (startAfter) {
          query = query.startAfter(startAfter);
        }
        const result = await query.limit(PAGE_SIZE).get();
        hasNextPage = result.docs.length === PAGE_SIZE;
        startAfter = result.docs[result.docs.length - 1].get('address');

        for (const doc of result.docs) {
          const docData = doc.data() as DocItem;
          if (docData.address) {
            fetch(`${UPDATE_SOCIAL_STATS_ENDPOINT}${docData.address}`)
              .then(() => {
                count++;
              })
              .catch((err: any) => console.error(err));
            await sleep(TRIGGER_TIMER);
          }
        }
      } catch (err) {
        console.error(err);
      }
      console.log('UpdateSocialStatsTrigger - Total collections updated:', count);
    }
  }

  async updateTrendingCollections() {
    console.log('Updating social stats for trending collections');
    try {
      const trendingCollectionsRef = this.db.collection(firestoreConstants.TRENDING_COLLECTIONS_COLL);
      const trendingByVolumeDoc = trendingCollectionsRef.doc(firestoreConstants.TRENDING_BY_VOLUME_DOC);
      const trendingByAvgPriceDoc = trendingCollectionsRef.doc(firestoreConstants.TRENDING_BY_AVG_PRICE_DOC);

      const dailyTrendingByVolumeColl = trendingByVolumeDoc.collection(StatsPeriod.Daily);
      const weeklyTrendingByVolumeColl = trendingByVolumeDoc.collection(StatsPeriod.Weekly);
      const monthlyTrendingByVolumeColl = trendingByVolumeDoc.collection(StatsPeriod.Monthly);

      const dailyTrendingByAvgPriceColl = trendingByAvgPriceDoc.collection(StatsPeriod.Daily);
      const weeklyTrendingByAvgPriceColl = trendingByAvgPriceDoc.collection(StatsPeriod.Weekly);
      const monthlyTrendingByAvgPriceColl = trendingByAvgPriceDoc.collection(StatsPeriod.Monthly);

      const allTrendingCollections = new Set<string>();

      const dailyTrendingByVolumeColls = await dailyTrendingByVolumeColl
        .orderBy('salesVolume', 'desc')
        .limit(100) // limit to top 100
        .get();
      dailyTrendingByVolumeColls.docs.map((doc) => allTrendingCollections.add(doc.data().contractAddress));

      const weeklyTrendingByVolumeColls = await weeklyTrendingByVolumeColl
        .orderBy('salesVolume', 'desc')
        .limit(100) // limit to top 100
        .get();
      weeklyTrendingByVolumeColls.docs.map((doc) => allTrendingCollections.add(doc.data().contractAddress));

      const monthlyTrendingByVolumeColls = await monthlyTrendingByVolumeColl
        .orderBy('salesVolume', 'desc')
        .limit(100) // limit to top 100
        .get();
      monthlyTrendingByVolumeColls.docs.map((doc) => allTrendingCollections.add(doc.data().contractAddress));

      const dailyTrendingByAvgPriceColls = await dailyTrendingByAvgPriceColl
        .orderBy('avgPrice', 'desc')
        .limit(100) // limit to top 100
        .get();
      dailyTrendingByAvgPriceColls.docs.map((doc) => allTrendingCollections.add(doc.data().contractAddress));

      const weeklyTrendingByAvgPriceColls = await weeklyTrendingByAvgPriceColl
        .orderBy('avgPrice', 'desc')
        .limit(100) // limit to top 100
        .get();
      weeklyTrendingByAvgPriceColls.docs.map((doc) => allTrendingCollections.add(doc.data().contractAddress));

      const monthlyTrendingByAvgPriceColls = await monthlyTrendingByAvgPriceColl
        .orderBy('avgPrice', 'desc')
        .limit(100) // limit to top 100
        .get();
      monthlyTrendingByAvgPriceColls.docs.map((doc) => allTrendingCollections.add(doc.data().contractAddress));

      let count = 0;
      console.log('Num trending collections to update social stats for:', allTrendingCollections.size);
      for (const collection of allTrendingCollections) {
        if (collection) {
          fetch(`${UPDATE_SOCIAL_STATS_ENDPOINT}${collection}`)
            .then(() => {
              count++;
            })
            .catch((err: any) => console.error(err));
          await sleep(TRIGGER_TIMER);
        }
      }
      console.log('UpdateSocialStatsTrigger - Total trending collections updated:', count);
    } catch (err) {
      console.error('error updating social stats for trending collections', err);
    }
  }
}
