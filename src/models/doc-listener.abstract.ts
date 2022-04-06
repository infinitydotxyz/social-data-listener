import Emittery from 'emittery';

export type DocSnapshotEmitter<T> = { docSnapshot: T };

export default abstract class DocListener<T> extends Emittery<DocSnapshotEmitter<T>> {
  constructor(protected _docRef: FirebaseFirestore.DocumentReference<T>) {
    super();
  }

  protected _listen() {
    this._docRef.onSnapshot((snapshot) => {
      const data = snapshot.data() as T;
      void this.emit('docSnapshot', data);
    });
  }
}
