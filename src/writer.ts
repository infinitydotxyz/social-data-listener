import { DiscordAnnouncementEvent, FeedEventType, TwitterTweetEvent } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { getDb } from './database';
import { SocialFeedEvent } from './services';
import { Twitter } from './services/twitter';

/**
 * Writes events to the feed collection in the database.
 * @param event
 */
export async function writer(event: SocialFeedEvent) {
  console.log(event);

  let snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> | null = null;

  switch (event.type) {
    case FeedEventType.TwitterTweet:
      snapshot = await getDb()
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .select('address')
        .where('metadata.links.twitter', '==', Twitter.appendHandle((event as TwitterTweetEvent).username))
        .get();
      break;
    case FeedEventType.DiscordAnnouncement:
      snapshot = await getDb()
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .select('address')
        .where('metadata.integrations.discord.guildId', '==', (event as DiscordAnnouncementEvent).guildId)
        .get();
      break;
    default:
      throw new Error(`Unexpected event '${event.type}'!`);
  }

  if (snapshot?.docs.length) {
    for (const doc of snapshot.docs) {
      await getDb()
        .collection(firestoreConstants.FEED_COLL)
        .doc(event.id)
        .set({ collectionAddress: doc.data().address, ...event });
    }
  } else {
    console.warn('Event received but not added to the feed!');
  }
}
