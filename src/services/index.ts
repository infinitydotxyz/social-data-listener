import { BaseFeedEvent } from '@infinityxyz/lib/types/core/feed';
import { getDb } from '../database';
import { Discord } from './discord';
import { Twitter } from './twitter';
import { CoinMarketCap } from './coinmarketcap';
import Listener from './listener';

export type SocialFeedEvent = BaseFeedEvent & { id: string };

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36';

/**
 * Starts all registered services asynchronously.
 */
export async function startServices(writer: (event: SocialFeedEvent) => Promise<void>) {
  const db = getDb();

  const twitter = new Twitter(
    {
      accessToken: process.env.TWITTER_OAUTH_ACCESS_TOKEN!,
      refreshToken: process.env.TWITTER_OAUTH_REFRESH_TOKEN!,
      listId: process.env.TWITTER_LIST_ID!,
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!
    },
    db
  );

  const discord = new Discord(
    {
      token: process.env.DISCORD_TOKEN!,
      appId: process.env.DISCORD_APP_ID!
    },
    db
  );

  const coinmarketcap = new CoinMarketCap(
    {
      page: 1,
      size: 20
    },
    db
  );

  const services: Listener<any>[] = [
    twitter
    // discord,
    // coinmarketcap
  ];

  for (const service of services) {
    await service.setup();
  }

  const monitors = services.map((service) => service.monitor(writer));

  await Promise.all(monitors);
}
