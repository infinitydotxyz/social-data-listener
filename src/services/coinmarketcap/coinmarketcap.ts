import Listener, { OnEvent } from '../listener';
import { FeedEventType } from '@infinityxyz/lib/types/core/feed';
import { CoinMarketCapConfig } from './config';
import {} from 'firebase-admin';
import phin from 'phin';
import { DEFAULT_USER_AGENT, SocialFeedEvent } from '..';

export class CoinMarketCap extends Listener<SocialFeedEvent> {
  private readonly url: string;

  constructor({ page = 1, size = 20 }: CoinMarketCapConfig, db: FirebaseFirestore.Firestore) {
    super(db);
    this.url = `https://api.coinmarketcap.com/content/v3/news?page=${page}&size=${size}`;
  }

  async setup() {}

  async monitor(handler: OnEvent<SocialFeedEvent>) {
    // TODO: periodically check API and push new events to feed accordingly
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
      const json = JSON.parse(body);
      console.log(json);
      handler({
        id: '0',
        comments: 0,
        likes: 0,
        timestamp: Date.now(),
        type: FeedEventType.NftOffer // TODO: change this!
      });
    } else {
      console.warn(`Invalid status code received from CoinMarketCap!`, res.statusCode, res.body.toString());
    }
  }
}
