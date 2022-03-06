import firebaseAdmin from 'firebase-admin';

export const ALL_COLLECTIONS = 'allCollections';
export const SOCIALS = 'socials';

/**
 * Creates a new connection to the database and returns the instance (if successful).
 */
export function initDb(serviceAccount: any) {
  firebaseAdmin.initializeApp({
    // @ts-ignore
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
