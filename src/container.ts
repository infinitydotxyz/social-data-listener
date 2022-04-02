import { getDb, initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';

initDb(serviceAccount);

export const firestore: FirebaseFirestore.Firestore = getDb();
