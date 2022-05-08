import { DiscordAnnouncementEvent, FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { SocialFeedEvent } from './services';
import { Twitter } from './services/twitter';

/**
 * Writes events to the feed collection in the database.
 * @param event
 */
export async function writer(event: SocialFeedEvent, db: FirebaseFirestore.Firestore) {
  console.log(event);

  switch (event.type) {
    case FeedEventType.TwitterTweet:
    case FeedEventType.DiscordAnnouncement:
      let query = db.collection(firestoreConstants.COLLECTIONS_COLL).select('address');

      if (event.type === FeedEventType.TwitterTweet)
        query = query.where('metadata.links.twitter', '==', Twitter.appendHandle((event as TwitterTweetEvent).username));
      else query = query.where('metadata.integrations.discord.guildId', '==', (event as DiscordAnnouncementEvent).guildId);

      const snapshot = await query.get();

      if (snapshot.size) {
        for (const doc of snapshot.docs) {
          const data = doc.data();
          await db
            .collection(firestoreConstants.FEED_COLL)
            .doc(event.id)
            .set({
              collectionAddress: data.address,
              collectionName: data.metadata.name,
              collectionSlug: data.slug,
              collectionProfileImage: data.metadata.profileImage,
              ...event
            });
        }
      } else {
        console.warn('Event received but not added to the feed!');
      }

      break;
    case FeedEventType.CoinMarketCapNews:
      await db.collection(firestoreConstants.FEED_COLL).doc(event.id).set(event);
      break;
    default:
      throw new Error(`Unexpected event '${event.type}'!`);
  }
}
