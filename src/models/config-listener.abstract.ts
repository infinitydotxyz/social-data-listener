import DocListener from './doc-listener.abstract';

export abstract class ConfigListener<T> extends DocListener<T> {
  protected _config: T;

  protected _isReady: Promise<void>;

  constructor(docRef: FirebaseFirestore.DocumentReference<T>) {
    super(docRef);
    this._config = {} as T;

    this._isReady = this._registerListener();
    this._listen();
  }

  private _registerListener(): Promise<void> {
    let resolved = false;
    return new Promise((resolve) => {
      this.on('docSnapshot', (data) => {
        this._config = data;
        if (!resolved) {
          resolve();
          resolved = true;
        }
      });
    });
  }
}
