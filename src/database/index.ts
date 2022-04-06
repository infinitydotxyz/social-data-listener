import firebaseAdmin, { ServiceAccount } from 'firebase-admin';

/**
 * Creates a new connection to the database and returns the instance (if successful).
 */
export function initDb(serviceAccount: ServiceAccount) {
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(serviceAccount)
  });

  return getDb();
}

/**
 * Returns the firestore instance (singleton).
 */
export function getDb() {
  return firebaseAdmin.firestore();
}
