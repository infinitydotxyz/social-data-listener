import { socialDataFirestoreConstants } from '../../constants';
import { firestore } from '../../container';
import { ConfigListener } from '../../models/config-listener.abstract';
import { TwitterConfig as ITwitterConfig } from './twitter.types';

export class TwitterConfig extends ConfigListener<ITwitterConfig> {
  static get ref() {
    return firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC) as FirebaseFirestore.DocumentReference<ITwitterConfig>;
  }

  constructor(initialValue: ITwitterConfig) {
    super(initialValue, TwitterConfig.ref);
  }
}
