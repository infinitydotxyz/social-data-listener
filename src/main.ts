import { initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Collection } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';

import { config as loadEnv } from 'dotenv';
import { Twitter } from './twitter';
import { Discord, isDiscordIntegration } from './discord';
import { BaseFeedEvent, FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';

// load environment vars
loadEnv();

// setup services
const db = initDb(serviceAccount);
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

main();

async function main() {
  // TODO: when a new verified collection gets added to the db, we should automatically start watching it too (stream firestore collection updates somehow?)

  const verifiedCollections = await db
    .collection(firestoreConstants.COLLECTIONS_COLL)
    .where('hasBlueCheck', '==', true)
    .select('metadata.links.twitter', 'address')
    .get();

  console.log(`Watching ${verifiedCollections.size} verified collections...`);

  // store all twitter accounts in memory
  const twitterAccounts = verifiedCollections.docs
    .map((snapshot) => {
      const { metadata, address } = snapshot.data() as Collection;
      const url = metadata.links.twitter;
      return { handle: url ? Twitter.extractHandle(url) : undefined, address };
    })
    .filter((data) => data.handle?.trim() != '');

  // store all discord servers in memory
  const discords = verifiedCollections.docs
    .map((snapshot) => (snapshot.data() as Collection).metadata.integrations?.discord)
    .filter(isDiscordIntegration);

  // writes an event to the database
  // the collection address that the event belongs should be found in memory
  const writer = async (event: BaseFeedEvent) => {
    console.log(event);
    if (event.type === FeedEventType.TwitterTweet) {
      const twitterEvent = event as TwitterTweetEvent;
      const account = twitterAccounts.find((account) => account.handle?.toLowerCase() === twitterEvent.username.toLowerCase());
      if (account)
        await db
          .collection(firestoreConstants.FEED_COLL)
          .doc(twitterEvent.id)
          .set({ collectionAddress: account.address, ...event });
    } else {
      // TODO: discord
    }
  };

  await twitter.updateStreamRules(twitterAccounts.map((account) => account.handle!));
  await Promise.all([discord.monitor(discords), twitter.monitor(writer)]);
}
