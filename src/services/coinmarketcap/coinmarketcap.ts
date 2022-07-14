import Listener, { OnEvent } from '../listener';
import { CoinMarketCapNewsEvent, EventType } from '@infinityxyz/lib/types/core/feed';
import { CoinMarketCapConfig } from './config';
import phin from 'phin';
import { DEFAULT_USER_AGENT } from '..';
import { Article } from './models';
import { ApiResponse } from './dto';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { deduplicate } from './utils';
import schedule from 'node-schedule';

export class CoinMarketCap extends Listener<CoinMarketCapNewsEvent> {
  private readonly url: string;

  constructor({ page = 1, size = 20 }: CoinMarketCapConfig, db: FirebaseFirestore.Firestore) {
    super(db);
    this.url = `https://api.coinmarketcap.com/content/v3/news?page=${page}&size=${size}`;
  }

  async setup() {}

  async monitor(handler: OnEvent<CoinMarketCapNewsEvent>) {
    // executes the job every hour (CMC seems to update their articles every hour as well so)
    // see: https://github.com/node-schedule/node-schedule#cron-style-scheduling
    // TODO: check which timezone CMC is using
    const job = schedule.scheduleJob(EventType.CoinMarketCapNews, '0 * * * *', async () => {
      const res = await phin({
        url: this.url,
        headers: {
          Accept: 'application/json',
          // 'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en;q=0.5',
          Host: 'api.coinmarketcap.com',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': DEFAULT_USER_AGENT
        }
      });

      if (res.statusCode === 200) {
        const body = res.body.toString();
        const json: ApiResponse<Article> = JSON.parse(body);
        let newsItems = json.data.filter((item) => item.meta.visibility ?? true);

        // Check for duplicates and modify the array of news items to add accordingly.
        const latestNewsItem = await this.db
          .collection(firestoreConstants.FEED_COLL)
          .select('id')
          .where('type', '==', EventType.CoinMarketCapNews)
          .orderBy('releasedAt', 'desc')
          .limit(1)
          .get();

        if (latestNewsItem.docs.length) {
          const doc = latestNewsItem.docs[0];
          const slug = doc.data().id;
          newsItems = deduplicate(newsItems, { slug });
        }

        for (const newsItem of newsItems) {
          handler({
            ...newsItem.meta,
            id: newsItem.slug,
            comments: 0,
            likes: 0,
            timestamp: Date.now(),
            type: EventType.CoinMarketCapNews,
            createdAtCMC: newsItem.createdAt
          });
        }
      } else {
        console.warn(`Invalid status code received from CoinMarketCap!`, res.statusCode, res.body.toString());
      }
    });

    console.log(`Scheduled job ${job.name} starting at: ${job.nextInvocation().toISOString()}`);
  }
}
