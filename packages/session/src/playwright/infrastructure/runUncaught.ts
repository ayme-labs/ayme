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

/** `run`, which also fails with an error nothing caught that code it
 * started throws before it settles. */
export function failingOnItsUncaught<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) =>
    runs.run(reject, () => void run().then(resolve, reject))
  );
}

/** Fails the Run `error` came from, if it came from one. A Run that has
 * already settled stays as it is. */
export function failItsRun(error: unknown): void {
  runs.getStore()?.(error);
}
