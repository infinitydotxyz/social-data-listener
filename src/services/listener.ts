export type OnEvent<T> = (event: T) => Promise<void>;

export default interface Listener<T> {
  setup(): Promise<void>;
  monitor(handler: OnEvent<T>): void;
}
