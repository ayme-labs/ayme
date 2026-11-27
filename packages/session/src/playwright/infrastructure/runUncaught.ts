// Ties an error nothing caught to the Run whose Page Object code left it,
// so that Run fails with it rather than wait for ever for a promise the
// error kept from settling (rule 12). Node 24 carries a Run's async context
// into the timers, ticks, microtasks and promises its code starts, and into
// the process's handlers of what nothing caught. A listener on an event
// emitter runs in the context of whoever emits, so an error a Page Object's
// listener throws on a browser event is tied to no Run: that Run still
// waits until `ayme close`.
import { AsyncLocalStorage } from "node:async_hooks";

const runs = new AsyncLocalStorage<(error: unknown) => void>();

/** An error nothing caught that a Run's code threw, which failed the Run
 * while its own work goes on until `ended` settles. */
export class LeftUncaught {
  constructor(
    readonly error: unknown,
    readonly ended: Promise<unknown>
  ) {}
}

/** `run`, which also fails, with a {@link LeftUncaught}, on an error
 * nothing caught that code it started throws before it settles. */
export function failingOnItsUncaught<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let running: Promise<T> | undefined;
    runs.run(
      (error) => reject(new LeftUncaught(error, running ?? Promise.resolve())),
      () => {
        running = run();
        running.then(resolve, reject);
      }
    );
  });
}

/** Fails the Run `error` came from, if it came from one. A Run that has
 * already settled stays as it is. */
export function failItsRun(error: unknown): void {
  runs.getStore()?.(error);
}
