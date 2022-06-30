import Listener from '../listener';
import schedule from 'node-schedule';
import fetch from 'node-fetch';
import { MAIN_API_URL } from '../../constants';

const PAUSE_BETWEEN_CALLS = 5 * 1000;
const STATS_BASE_URL = `${MAIN_API_URL}/collections/update-trending-stats`;

const statsEndpoints = [
  `${STATS_BASE_URL}?period=daily&queryBy=by_sales_volume`,
  `${STATS_BASE_URL}?period=weekly&queryBy=by_sales_volume`,
  `${STATS_BASE_URL}?period=monthly&queryBy=by_sales_volume`,
  `${STATS_BASE_URL}?period=daily&queryBy=by_avg_price`,
  `${STATS_BASE_URL}?period=weekly&queryBy=by_avg_price`,
  `${STATS_BASE_URL}?period=monthly&queryBy=by_avg_price`
];

export class TrendingStatsTrigger extends Listener<unknown> {
  constructor({}, db: FirebaseFirestore.Firestore) {
    super(db);
  }

  async setup() {}

  async monitor(handler?: unknown) {
    console.log(`Started TrendingStatsTrigger`);
    // run once
    this.run();

    // then run every 12 hours
    const job = schedule.scheduleJob('TrendingStatsTrigger', '0 */12 * * *', async () => {
      console.log(`Scheduled job [${job.name}] started at ${job.nextInvocation().toISOString()}`);
      this.run();
    });
  }

  async run() {
    let timer = 0;
    for (let i = 0; i < statsEndpoints.length; i++) {
      setTimeout(() => {
        const url = statsEndpoints[i];
        fetch(url, { method: 'PUT' })
          .then(() => {
            console.log('fetched top collections stats', url);
          })
          .catch((err: any) => console.error(err));
      }, timer);
      timer = PAUSE_BETWEEN_CALLS;
    }
  }
}
