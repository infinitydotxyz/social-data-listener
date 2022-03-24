export type OnEvent<T> = (event: T) => Promise<void>;

export default abstract class Listener<T> {
  protected db: FirebaseFirestore.Firestore;

  constructor(db: FirebaseFirestore.Firestore) {
    this.db = db;
  }

  abstract setup(): Promise<void>;
  abstract monitor(handler: OnEvent<T>): void;
}
