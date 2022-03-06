import { ALL_COLLECTIONS, initDb, SOCIALS } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Links } from '@infinityxyz/types/core';

const db = initDb(serviceAccount);

main();

async function main() {
  const verifiedCollections = await db.collection(ALL_COLLECTIONS).where('hasBlueCheck', '==', true).select('socials').get();

  verifiedCollections.forEach(async (col) => {
    const snapshot = await col.ref.collection(SOCIALS).doc('links').get();
    if (snapshot.exists) {
      const { twitter, discord } = snapshot.data() as Links;
      console.log(twitter, discord);
    }
  });

  // TODO: when a new verified collection gets added to the db, we should automatically start watching it too (stream?)

  console.log(`Watching ${verifiedCollections.size} verified collections...`);
}
