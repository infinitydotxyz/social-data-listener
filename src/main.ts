import { COLLECTIONS, initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Collection } from '@infinityxyz/lib/types/core';
import { config as loadEnv } from 'dotenv';
import { Twitter } from './twitter';
import { Discord } from './discord';

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
  token: process.env.DISCORD_TOKEN!
});

main();

async function main() {
  // TODO: when a new verified collection gets added to the db, we should automatically start watching it too (stream firestore collection updates somehow?)
  // TODO: store in firebase

  const verifiedCollections = await db.collection(COLLECTIONS).where('hasBlueCheck', '==', true).select('metadata.links').get();

  console.log(`Watching ${verifiedCollections.size} verified collections...`);

  const twitterAccounts = verifiedCollections.docs
    .map((snapshot) => (snapshot.data() as Collection).metadata.links.twitter)
    .filter((url) => url?.trim() != '')
    .map((url) => Twitter.extractHandle(url!));

  let discordChannels: Set<string> = new Set();
  verifiedCollections.forEach((snapshot) => {
    const collection = snapshot.data() as Collection;
    const channels = collection.metadata.integrations?.discord?.channels ?? [];
    for (const channel of channels) discordChannels.add(channel);
  });

  await twitter.updateStreamRules(twitterAccounts);
  await Promise.all([discord.monitor(discordChannels), twitter.streamTweets(console.log)]);
}
