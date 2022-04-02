import { container } from 'tsyringe';
import { getDb } from './database';
import { TwitterConfig } from './services/twitter/twitter.config';

export const firestore: FirebaseFirestore.Firestore = getDb();
