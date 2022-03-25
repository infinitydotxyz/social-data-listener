import { BaseFeedEvent } from '@infinityxyz/lib/types/core/feed';
import { getDb } from '../database';
import { Discord } from './discord';
import { Twitter } from './twitter';
import { CoinMarketCap } from './coinmarketcap';

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
      apiKey: process.env.TWITTER_API_KEY!,
      apiKeySecret: process.env.TWITTER_API_KEY_SECRET!,
      bearerToken: process.env.TWITTER_BEARER_TOKEN,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
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

  const services = [
    // twitter,
    discord,
    coinmarketcap
  ];

  for (const service of services) {
    await service.setup();
  }

  const monitors = services.map((service) => service.monitor(writer));

  await Promise.all(monitors);
}
