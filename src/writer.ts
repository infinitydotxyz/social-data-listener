import { BaseCollection, Collection } from '@infinityxyz/lib/types/core';
import { DiscordAnnouncementEvent, EventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { SocialFeedEvent } from './services';
import { Twitter } from './services/twitter';

/**
 * Writes events to the feed collection in the database.
 * @param event
 */
export async function writer(event: SocialFeedEvent, db: FirebaseFirestore.Firestore) {
  switch (event.type) {
    case EventType.TwitterTweet:
    case EventType.DiscordAnnouncement:
      const collRef = db.collection(firestoreConstants.COLLECTIONS_COLL);
      let query;
      if (event.type === EventType.TwitterTweet) {
        query = collRef.where('metadata.links.twitter', '==', Twitter.appendHandle((event as TwitterTweetEvent).username));
      } else {
        query = collRef.where('metadata.integrations.discord.guildId', '==', (event as DiscordAnnouncementEvent).guildId);
      }

      const snapshot = await query.get();

      if (snapshot.size) {
        for (const doc of snapshot.docs) {
          const data = doc.data() as BaseCollection;
          if (data) {
            await db
              .collection(firestoreConstants.FEED_COLL)
              .doc(event.id)
              .set({
                collectionAddress: data.address,
                collectionName: data.metadata?.name,
                collectionSlug: data.slug,
                collectionProfileImage: data.metadata?.profileImage,
                ...event
              });
            console.log(`${event.type} event added to feed`);
          } else {
            console.log(`${event.type} event not added to feed since data is null`);
          }
        }
      } else {
        console.warn('Event received but not added to feed');
      }

      break;
    case EventType.CoinMarketCapNews:
      await db.collection(firestoreConstants.FEED_COLL).doc(event.id).set(event);
      console.log(`${event.type} event added to feed`);
      break;
    default:
      throw new Error(`Unexpected event '${event.type}'!`);
  }
}
