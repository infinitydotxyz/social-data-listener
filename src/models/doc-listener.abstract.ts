import Emittery from 'emittery';

export type DocSnapshotEmitter<T, Extends = Record<string, any>> = Extends & { docSnapshot: T };

export default abstract class DocListener<T, EventData extends { docSnapshot: T }> extends Emittery<EventData> {
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
