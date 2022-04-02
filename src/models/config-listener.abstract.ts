import DocListener from './doc-listener.abstract';

export abstract class ConfigListener<T> extends DocListener<T> {
  private _config: T;

  public get config(): T {
    return this._config;
  }

  constructor(initialValue: T, docRef: FirebaseFirestore.DocumentReference<T>) {
    super(docRef);
    this._config = initialValue;
    this._registerListener();
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
