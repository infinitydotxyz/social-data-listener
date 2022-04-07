import { sleep } from '@infinityxyz/lib/utils';
import { VoiceBasedChannel } from 'discord.js';

export class Debouncer<Input, Output> {
  private isRunning = false;
  private queue: { value: Input; id: string }[] = [];

  private outputPromises: Map<
    string,
    { resolve: (value: Output | PromiseLike<Output>) => void; reject: (reason?: any) => void }
  > = new Map();

  constructor(
    private readonly options: { timeout: number; maxBatchSize: number },
    private readonly fn: (
      inputs: { value: Input; id: string }[]
    ) => Promise<({ output: Output; id: string } | { id: string; error: Error })[]>
  ) {}

  public async enqueue(id: string, value: Input): Promise<Output> {
    console.log(`Enqueuing ${id} ${value}`);

    const promise = new Promise<Output>((res, rej) => {
      this.outputPromises.set(id, {
        resolve: res,
        reject: rej
      });
    });

    this.queue.push({ id, value });
    void this.mutexProcess();

    return promise;
  }

  private async mutexProcess() {
    if (!this.isRunning) {
      this.isRunning = true;
      try {
        await this.process();
      } catch (err) {
        console.error('Failed to process batches', err);
      }
      this.isRunning = false;
    }
  }

  private async process() {
    while (this.queue.length > 0) {
      await sleep(this.options.timeout);
      const batch = this.queue.splice(0, this.options.maxBatchSize);
      try {
        const results = await this.fn(batch);
        for (const output of results) {
          const promise = this.outputPromises.get(output.id);
          if (promise) {
            if ('error' in output) {
              promise.reject(output.error);
            } else {
              promise.resolve(output.output);
            }
            this.outputPromises.delete(output.id);
          }
        }
      } catch (err) {
        for (const item of batch) {
          this.outputPromises.get(item.id)?.reject(err);
          this.outputPromises.delete(item.id);
        }
      }
    }
  }
}
