import { DiscordAnnouncementEvent, FeedEventType } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { SocialFeedEvent } from './services';

/**
 * Writes events to the feed collection in the database.
 * @param event
 */
export async function writer(event: SocialFeedEvent, db: FirebaseFirestore.Firestore) {
  switch (event.type) {
    case FeedEventType.TwitterTweet:
      const feedDoc = db.collection(firestoreConstants.FEED_COLL);
      const doc = await feedDoc.add(event);
      console.log(`wrote tweet to feed ${doc.id}`);
      break;

    case FeedEventType.DiscordAnnouncement:
      let query = db.collection(firestoreConstants.COLLECTIONS_COLL).select('address');

      query = query.where('metadata.integrations.discord.guildId', '==', (event as DiscordAnnouncementEvent).guildId);

      const snapshot = await query.get();

      if (snapshot?.docs.length) {
        for (const doc of snapshot.docs) {
          await db
            .collection(firestoreConstants.FEED_COLL)
            .doc(event.id)
            .set({ collectionAddress: doc.data().address, ...event });
        }
      } else {
        console.warn('Event received but not added to the feed!');
      }

      break;
    case FeedEventType.CoinMarketCapNews:
      // Await db.collection(firestoreConstants.FEED_COLL).doc(event.id).set(event);
      break;
    default:
      throw new Error(`Unexpected event '${event.type}'!`);
  }
}
