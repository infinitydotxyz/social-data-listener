import { BaseFeedEvent } from '@infinityxyz/lib/types/core/feed';
import { Discord } from './discord';
import { Twitter } from './twitter';

/**
 * Starts all registered services asynchronously.
 */
export async function startServices(writer: (event: SocialFeedEvent) => Promise<void>) {
  const twitter = new Twitter({
    apiKey: process.env.TWITTER_API_KEY!,
    apiKeySecret: process.env.TWITTER_API_KEY_SECRET!,
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
  });

  const discord = new Discord({
    token: process.env.DISCORD_TOKEN!,
    appId: process.env.DISCORD_APP_ID!
  });

  const services = [
    // twitter,
    discord
  ];

  for (const service of services) {
    await service.setup();
  }

  const monitors = services.map((service) => service.monitor(writer));

  await Promise.all(monitors);
}

export type SocialFeedEvent = BaseFeedEvent & { id: string };
