export type OnEvent<T> = (event: T) => Promise<void>;

export default interface Listener<T> {
  monitor(handler: OnEvent<T>): void;
}
