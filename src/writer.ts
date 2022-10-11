import { EventType } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { SocialFeedEvent } from './services';

/**
 * Writes events to the feed collection in the database.
 * @param event
 */
export async function writer(event: SocialFeedEvent, db: FirebaseFirestore.Firestore) {
  switch (event.type) {
    case EventType.TwitterTweet:
    case EventType.DiscordAnnouncement:
      await db.collection(firestoreConstants.FEED_COLL).doc(event.id).set(event);
      console.log(`${event.type} event added to feed`);
      break;
    case EventType.CoinMarketCapNews:
      await db.collection(firestoreConstants.FEED_COLL).doc(event.id).set(event);
      console.log(`${event.type} event added to feed`);
      break;
    default:
      throw new Error(`Unexpected event '${event.type}'!`);
  }
}
