import { Context, Deferred, Effect, Layer, Queue } from "effect";

import type {
  CommandResult,
  RecorderCommand,
  RecorderUpdate,
  RecordingOutcome,
} from "../../contract";
import { initialState, step, type Happening } from "../domain/lifecycle";
import { RecordedBrowser } from "./recordedBrowser";

/** One thing that happened, waiting for its turn, and where a command's
 * answer goes. */
type Queued = {
  readonly happening: Happening;
  readonly reply?: Deferred.Deferred<CommandResult>;
};

/**
 * One live recorder: one queue with one worker. Commands, the outside end and
 * the browser's signals all go into the queue and are handled one at a time,
 * each by one step of the lifecycle.
 */
export class RecorderSession extends Context.Service<
  RecorderSession,
  {
    readonly send: (command: RecorderCommand) => Effect.Effect<CommandResult>;
    /** The outside end. */
    readonly end: Effect.Effect<void>;
    /** Calls the listener at once with the full state, then with every
     * change. Returns "unsubscribe". */
    readonly subscribe: (
      listener: (update: RecorderUpdate) => void
    ) => () => void;
    /** Waits for the recorder's end. */
    readonly done: Effect.Effect<RecordingOutcome>;
  }
>()("@ayme-dev/recorder/session/RecorderSession") {
  static readonly layer = Layer.effect(
    RecorderSession,
    Effect.gen(function* () {
      const browser = yield* RecordedBrowser;
      const queue = yield* Queue.unbounded<Queued>();
      const done = yield* Deferred.make<RecordingOutcome>();
      const listeners = new Set<(update: RecorderUpdate) => void>();
      let update: RecorderUpdate = { revision: 0, state: initialState };

      const handle = Effect.fnUntraced(function* ({
        happening,
        reply,
      }: Queued) {
        const { state, todo } = step(update.state, happening);
        if (state !== update.state) {
          update = { revision: update.revision + 1, state };
          for (const listener of listeners) listener(update);
        }
        for (const item of todo) {
          if (item.kind === "end") yield* Deferred.succeed(done, item.outcome);
          else if (reply) yield* Deferred.succeed(reply, item.result);
        }
      });

      // The browser's signals join the queue in the order the browser gave them.
      yield* Queue.take(browser.signals).pipe(
        Effect.flatMap((happening) => Queue.offer(queue, { happening })),
        Effect.forever,
        Effect.forkScoped
      );
      // The one worker.
      yield* Queue.take(queue).pipe(
        Effect.flatMap(handle),
        Effect.forever,
        Effect.forkScoped
      );

      return RecorderSession.of({
        send: Effect.fnUntraced(function* (command: RecorderCommand) {
          const reply = yield* Deferred.make<CommandResult>();
          yield* Queue.offer(queue, {
            happening: { kind: "command", command },
            reply,
          });
          return yield* Deferred.await(reply);
        }),
        end: Effect.asVoid(
          Queue.offer(queue, { happening: { kind: "outsideEnd" } })
        ),
        subscribe: (listener) => {
          listeners.add(listener);
          listener(update);
          return () => listeners.delete(listener);
        },
        done: Deferred.await(done),
      });
    })
  );
}
