import { COLLECTIONS, initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Collection } from '@infinityxyz/types/core';
import { config as loadEnv } from 'dotenv';
import { Twitter } from './twitter';

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

main();

async function main() {
  // TODO: when a new verified collection gets added to the db, we should automatically start watching it too (stream firestore collection updates somehow?)

  // TODO: write test with the following data (turns out this is exactly 512 in charlength, just enough to test AccessLevel.Essential lmao):
  /* twitter.updateStreamRules([
    'goatlodge',       'BattleVerse_io',
    'chromorphs',      'bullsontheblock',
    'JohnOrionYoung',  'the_n_project_',
    'superplastic',    'PixlsOfficial',
    'LuckyManekiNFT',  'TheProjectURS',
    'robotosNFT',      'satoshibles',
    'SaconiGen',       'FatalesNFT',
    '10KTFShop',       'nahfungiblebone',
    'lostsoulsnft',    'DropBearsio',
    'cryptoadzNFT',    'MekaVerse',
    'boredapeyc',      'pudgy_penguins',
    'worldofwomennft',
  ]); */

  const verifiedCollections = await db.collection(COLLECTIONS).where('hasBlueCheck', '==', true).select('metadata.links').get();

  console.log(`Watching ${verifiedCollections.size} verified collections...`);

  const twitterAccounts = verifiedCollections.docs
    .map((snapshot) => (snapshot.data() as Collection).metadata.links.twitter)
    .filter((url) => url?.trim() != '')
    .map((url) => Twitter.extractHandle(url!));

  await twitter.updateStreamRules(twitterAccounts);
  // TODO: store in firebase
  await twitter.streamTweets(console.log); // this should keep running forever. when we add discord we can hopefully use Promise.all(), without the need for thread workers.
}
