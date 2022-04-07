import { DEFAULT_TWEET_POLL_INTERVAL, socialDataFirestoreConstants } from '../../constants';
import { firestore } from '../../container';
import { ConfigListener } from '../../models/config-listener.abstract';
import { TwitterConfig as ITwitterConfig } from './twitter.types';

export const defaultTwitterConfig: ITwitterConfig = {
  maxListsPerAccount: 5,
  maxMembersPerList: 1000,
  defaultTweetPollInterval: DEFAULT_TWEET_POLL_INTERVAL
};

export class TwitterConfig extends ConfigListener<ITwitterConfig, { docSnapshot: ITwitterConfig }> {
  static get ref() {
    return firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC) as FirebaseFirestore.DocumentReference<ITwitterConfig>;
  }

  constructor(initialValue: ITwitterConfig) {
    super(initialValue, TwitterConfig.ref);
  }
}
