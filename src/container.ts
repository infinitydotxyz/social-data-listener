import { ServiceAccount } from 'firebase-admin';
import { getDb, initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';

initDb(serviceAccount as ServiceAccount);

export const firestore: FirebaseFirestore.Firestore = getDb();
