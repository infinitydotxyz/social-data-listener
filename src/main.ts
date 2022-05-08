import { initDb } from './database';
import serviceAccountDev from './database/creds/nftc-dev-firebase-creds.json';
import serviceAccountProd from './database/creds/nftc-dev-firebase-creds.json'; // TODO: change to prod service account

import { config as loadEnv } from 'dotenv';
import { startServices } from './services';
import { writer as write } from './writer';
import { NODE_ENV } from './constants';

// load environment vars
loadEnv();

// init db connection
const db = initDb(NODE_ENV === 'dev' ? serviceAccountDev : serviceAccountProd);

main();

async function main() {
  await startServices((event) => write(event, db));
}
