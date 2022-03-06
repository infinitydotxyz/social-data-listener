import { COLLECTIONS, initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Links, Collection } from '@infinityxyz/types/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

const db = initDb(serviceAccount);

main();

async function main() {
  const verifiedCollections = await db.collection(COLLECTIONS).where('hasBlueCheck', '==', true).select('metadata.links').get();

  verifiedCollections.forEach((doc) => {
    const { metadata } = doc.data() as Collection;
    const twitter = metadata.links.twitter;
    const discord = metadata.links.discord;
    console.log(twitter, discord);
  });

  // TODO: when a new verified collection gets added to the db, we should automatically start watching it too (stream?)

  console.log(`Watching ${verifiedCollections.size} verified collections...`);
}
