import { BaseFeedEvent } from '@infinityxyz/lib/types/core/feed';
import { getDb } from '../database';
import { Discord } from './discord';
import { Twitter } from './twitter';
import { CoinMarketCap } from './coinmarketcap';
import { UpdateSocialStatsTrigger } from './update-social-stats-trigger';
import { TrendingStatsTrigger } from './trending-stats-trigger';
import {
  DISCORD_ADMIN_SERVER_ID,
  DISCORD_ADMIN_SERVER_MONITOR_CHANNEL,
  DISCORD_APP_ID,
  DISCORD_TOKEN,
  TWITTER_BEARER_TOKEN
} from '../constants';

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
      bearerToken: TWITTER_BEARER_TOKEN
    },
    db
  );

  const discord = new Discord(
    {
      token: DISCORD_TOKEN,
      appId: DISCORD_APP_ID,
      adminGuildId: DISCORD_ADMIN_SERVER_ID,
      adminMonitorChannelId: DISCORD_ADMIN_SERVER_MONITOR_CHANNEL
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

  const updateSocialStatsTrigger = new UpdateSocialStatsTrigger({}, db);
  const trendingStatsTrigger = new TrendingStatsTrigger({}, db);

  const services = [discord, coinmarketcap, updateSocialStatsTrigger, trendingStatsTrigger];

  for (const service of services) {
    await service.setup();
  }

  const monitors = services.map((service) => service.monitor(writer));

  await Promise.all(monitors);
}
