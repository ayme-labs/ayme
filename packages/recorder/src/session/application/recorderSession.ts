import { Cause, Clock, Context, Deferred, Effect, Layer, Queue } from "effect";

import type {
  CommandResult,
  RecorderCommand,
  RecorderUpdate,
  RecordingOutcome,
} from "../../contract";
import { Timeline } from "../../timeline/domain";
import {
  initialState,
  shown,
  step,
  type Happening,
  type ToDo,
} from "../domain/lifecycle";
import { RecordedBrowser } from "./recordedBrowser";

/**
 * Writes a timeline as a Recording Package made at `createdAt`. Resolves
 * with the package's folder, or with null when there was nothing to write.
 * The session is handed it: where and how a package is kept is not its to
 * know.
 */
export type SaveRecording = (
  timeline: Timeline,
  createdAt: Date
) => Promise<string | null>;

/** One thing that happened, waiting for its turn, and where a command's
 * answer goes. */
type Queued = {
  readonly happening: Happening;
  readonly reply?: Deferred.Deferred<CommandResult>;
};

/**
 * One live recorder: one queue with one worker. Commands, the outside end,
 * the browser's signals, a time limit that passed and a save that is done all
 * go into the queue and are handled one at a time, each by one step of the
 * lifecycle. The worker then carries out the step's list, in its order. It
 * never waits on the browser: a request is handed over, and its answer is
 * one more thing that happens.
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
  static readonly layer = (options: { readonly save: SaveRecording }) =>
    Layer.effect(
      RecorderSession,
      Effect.gen(function* () {
        const browser = yield* RecordedBrowser;
        const queue = yield* Queue.unbounded<Queued>();
        const done = yield* Deferred.make<RecordingOutcome>();
        const listeners = new Set<(update: RecorderUpdate) => void>();
        const timeline = new Timeline();
        let state = initialState;
        let visits = timeline.visits();
        let update: RecorderUpdate = {
          revision: 0,
          state: { ...shown(state), visits },
        };
        /** Tells the listeners the recorder as it is now, under a new revision. */
        const publish = () => {
          visits = timeline.visits();
          update = {
            revision: update.revision + 1,
            state: { ...shown(state), visits },
          };
          for (const listener of listeners) listener(update);
        };
        /** Tells them, if the timeline has a Visit or an entry more. */
        const publishEntries = Effect.sync(() => {
          if (timeline.visits() !== visits) publish();
        });
        const tell = (happening: Happening) =>
          Queue.offer(queue, { happening });
        /** The answer the lifecycle keeps for a later step. */
        let deferred: Queued["reply"];

        const carryOut = Effect.fnUntraced(function* (
          item: ToDo,
          reply: Queued["reply"]
        ) {
          switch (item.kind) {
            case "reply":
              if (reply) yield* Deferred.succeed(reply, item.result);
              return;
            case "deferReply":
              deferred = reply;
              return;
            case "replyDeferred":
              if (deferred) yield* Deferred.succeed(deferred, item.result);
              deferred = undefined;
              return;
            case "browser":
              return yield* browser.ask(item.ask);
            case "timeline":
              // An entry is told as soon as it is produced.
              yield* Effect.promise(() => timeline.add(item.add));
              return yield* publishEntries;
            case "startTimeLimit":
              // It runs beside the queue, and ends with the recorder.
              return yield* Effect.sleep(item.ms).pipe(
                Effect.andThen(tell({ kind: "timeLimitPassed" })),
                Effect.forkScoped
              );
            case "save": {
              const createdAt = new Date(yield* Clock.currentTimeMillis);
              const folder = yield* Effect.promise(() =>
                options.save(timeline, createdAt)
              );
              // What changed after the last Interaction is an entry now.
              yield* publishEntries;
              return yield* tell({ kind: "saved", folder });
            }
            case "end":
              return yield* Deferred.succeed(done, item.outcome);
          }
        });

        const handle = Effect.fnUntraced(function* ({
          happening,
          reply,
        }: Queued) {
          const next = step(state, happening);
          state = next.state;
          // Only what shows from outside is told: a phase is one state
          // there. It is told before the step's list is carried out, so
          // that "saving" shows while the package is written.
          if (state.phase !== update.state.phase) publish();
          for (const item of next.todo) yield* carryOut(item, reply);
        });

        // What the browser told while it started comes before anything that
        // is asked of the recorder: the pages that are open, for one.
        for (const happening of yield* Queue.clear(browser.signals))
          yield* tell(happening);
        // The browser's signals join the queue in the order the browser gave them.
        yield* Queue.take(browser.signals).pipe(
          Effect.flatMap(tell),
          Effect.forever,
          Effect.forkScoped
        );
        // The one worker. If carrying something out breaks it, as when the
        // package cannot be written, the lifecycle is told, and the recorder
        // ends "failed": nobody waits for an end that cannot come.
        yield* Queue.take(queue).pipe(
          Effect.flatMap(handle),
          Effect.forever,
          Effect.catchCause((cause) => {
            const broken = Cause.squash(cause);
            return handle({
              happening: {
                kind: "brokeDown",
                reason:
                  broken instanceof Error ? broken.message : String(broken),
              },
            });
          }),
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
          end: Effect.asVoid(tell({ kind: "outsideEnd" })),
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
