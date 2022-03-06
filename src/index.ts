import { COLLECTIONS, initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Collection, OrderDirection } from '@infinityxyz/types/core';
import { config as loadEnv } from 'dotenv';
import Twitter from './twitter';

// load environment vars
loadEnv();

// setup services
const db = initDb(serviceAccount);
const twitter = new Twitter({
  apiKey: process.env.TWITTER_API_KEY!,
  apiKeySecret: process.env.TWITTER_API_KEY_SECRET!,
  bearerToken: process.env.TWITTER_API_KEY_BEARER_TOKEN!
});

main();

async function main() {
  const verifiedCollections = await db.collection(COLLECTIONS).where('hasBlueCheck', '==', true).select('metadata.links').get();

  const twitterAccounts = verifiedCollections.docs
    .map((snapshot) => {
      const {
        metadata: { links }
      } = snapshot.data() as Collection;
      return links.twitter;
    })
    .filter((account) => account?.trim() != '')
    .map((url) => Twitter.extractHandle(url!));

  console.log(twitterAccounts);

  // TODO: when a new verified collection gets added to the db, we should automatically start watching it too (stream?)

  console.log(`Watching ${verifiedCollections.size} verified collections...`);
}
