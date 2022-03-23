import { initDb } from './database';
import serviceAccount from './database/creds/nftc-dev-firebase-creds.json';
import { Collection } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';

import { config as loadEnv } from 'dotenv';
import { Twitter } from './twitter';
import { Discord } from './discord';
import {
  BaseFeedEvent,
  DiscordAnnouncementEvent as DiscordEvent,
  FeedEventType,
  TwitterTweetEvent
} from '@infinityxyz/lib/types/core/feed';

// load environment vars
loadEnv();

// setup services
const db = initDb(serviceAccount);
const twitter = new Twitter({
  apiKey: process.env.TWITTER_API_KEY!,
  apiKeySecret: process.env.TWITTER_API_KEY_SECRET!,
  bearerToken: process.env.TWITTER_BEARER_TOKEN,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});
const discord = new Discord({
  token: process.env.DISCORD_TOKEN!,
  appId: process.env.DISCORD_APP_ID!
});

main();

async function main() {
  const query = db.collection(firestoreConstants.COLLECTIONS_COLL).where('state.create.step', '==', 'complete');

  // await configureTwitterApi(query);

  // writes an event to the database
  // the collection address that the event belongs should be found in memory
  const writer = async (event: BaseFeedEvent & { id: string }) => {
    console.log(event);

    let snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> | null = null;

    switch (event.type) {
      case FeedEventType.TwitterTweet:
        snapshot = await db
          .collection(firestoreConstants.COLLECTIONS_COLL)
          .select('address')
          .where('metadata.links.twitter', '==', Twitter.appendHandle((event as TwitterTweetEvent).username))
          .limit(1)
          .get();
        break;
      case FeedEventType.DiscordAnnouncement:
        snapshot = await db
          .collection(firestoreConstants.COLLECTIONS_COLL)
          .select('address')
          .where('metadata.integrations.discord.guildId', '==', (event as DiscordEvent).guildId)
          .limit(1)
          .get();
        break;
      default:
        throw new Error(`Unexpected event '${event.type}'!`);
    }

    if (snapshot?.docs.length) {
      const doc = snapshot.docs[0];
      await db
        .collection(firestoreConstants.FEED_COLL)
        .doc(event.id)
        .set({ collectionAddress: doc.data().address, ...event });
    } else {
      console.warn('Event received but not added to the feed!');
    }
  };

  await Promise.all([
    discord.monitor(writer)
    // twitter.monitor(writer)
  ]);
}

async function configureTwitterApi(query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>) {
  await twitter.deleteStreamRules();

  const unsubscribe = query.onSnapshot(async (snapshot) => {
    const changes = snapshot.docChanges();

    const twitterHandlesAdded = changes
      .filter((change) => change.type === 'added' && change.doc.data().metadata?.links?.twitter)
      .map((change) => Twitter.extractHandle(change.doc.data().metadata.links.twitter))
      .filter((handle) => !!handle.trim());

    // TODO: properly handle 'modified' and 'removed' documents.
    // The problem is that we can't exactly delete or modify one exact rule because atm one rule monitors multiple accounts.
    // We might be able to get around this limitation once we can apply many more (and preferably unlimited) rules per twitter handle via some kind of commercial API access.
    // For the time being, we just inefficiently re-create the rule from scratch whenever a document is deleted or modified (only when twitter url changed).
    if (
      changes.some(
        (change) =>
          (change.type === 'modified' &&
            !snapshot.docs.some((old) => old.data().metadata?.links?.twitter === change.doc.data().metadata?.links?.twitter)) ||
          change.type === 'removed'
      )
    ) {
      console.log(`Resetting twitter streaming API rules (document modified or deleted)`);
      unsubscribe();
      return await configureTwitterApi(query);
    }

    if (twitterHandlesAdded.length) {
      console.log(`Monitoring ${twitterHandlesAdded.length} new twitter handles`);
      await twitter.updateStreamRules(twitterHandlesAdded);
    }
  });

  return unsubscribe;
}
