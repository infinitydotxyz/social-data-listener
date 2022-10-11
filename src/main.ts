import { initDb } from './database';
import serviceAccountDev from './database/creds/nftc-dev-firebase-creds.json';
import serviceAccountProd from './database/creds/nftc-infinity-firebase-creds.json';
import 'dotenv/config';

import { startServices } from './services';
import { writer as write } from './writer';
import { NODE_ENV } from './constants';
import { TwitterApiV2Settings } from 'twitter-api-v2';
// This is a hack to make Multer available in the Express namespace
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Multer } from 'multer';

// optionally enable twitter API debugging
TwitterApiV2Settings.debug = !!process.env.DEBUG || false;
TwitterApiV2Settings.logger = {
  log: console.info
};

// init db connection
const db = initDb(NODE_ENV === 'dev' ? serviceAccountDev : serviceAccountProd);

main();

async function main() {
  await startServices((event) => write(event, db));
}
