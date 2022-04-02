import Emittery from 'emittery';

export type DocSnapshotEmitter<T> = { docSnapshot: T };

export default abstract class DocListener<T> extends Emittery<DocSnapshotEmitter<T>> {
  constructor(private docRef: FirebaseFirestore.DocumentReference<T>) {
    super();
  }

  protected _listen() {
    this.docRef.onSnapshot((snapshot) => {
      const data = snapshot.data() as T;
      this.emit('docSnapshot', data);
    });
  }
}
