import { initDb } from './database';
import serviceAccountDev from './database/creds/nftc-dev-firebase-creds.json';
import serviceAccountProd from './database/creds/nftc-dev-firebase-creds.json'; // TODO: change to prod service account

// Try to load local environment variables from .env.
// If the dotenv dependency is not installed (i.e in prod), then no environment variables will be loaded.
try {
  const { config: loadEnv } = require('dotenv');
  loadEnv();
} catch (err) {}

import { startServices } from './services';
import { writer as write } from './writer';
import { NODE_ENV } from './constants';

// init db connection
const db = initDb(NODE_ENV === 'dev' ? serviceAccountDev : serviceAccountProd);

main();

async function main() {
  await startServices((event) => write(event, db));
}
