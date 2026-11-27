import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Queue,
} from "effect";

import type {
  CommandResult,
  RecorderCommand,
  RecorderUpdate,
  RecorderWarning,
  RecordingOutcome,
} from "../../contract";
import {
  Timeline,
  type InteractionReport,
  type RecordingTrace,
  type TimelineAddition,
} from "../../timeline/domain";
import {
  awaitsAnswer,
  initialState,
  offered,
  openAddress,
  shown,
  step,
  type BrowserRequest,
  type Happening,
  type LifecycleState,
  type ToDo,
} from "../domain/lifecycle";
import { RecordedBrowser } from "./recordedBrowser";

/**
 * Writes a timeline as a Recording Package made at `createdAt`, with the
 * recording's trace beside it when it has one. Resolves with the package's
 * folder, or with null when there was nothing to write.
 * The session is handed it: where and how a package is kept is not its to
 * know.
 */
export type SaveRecording = (
  timeline: Timeline,
  createdAt: Date,
  trace: RecordingTrace | null
) => Promise<string | null>;

/** Why something broke, for a person. */
const reasonOf = (broken: unknown) =>
  broken instanceof Error ? broken.message : String(broken);

/** That the timeline could not take an addition, for a person: the step by
 * its name when the addition is one, or else the kind of addition, and that
 * the trace has it all the same, since the trace is the browser's and not
 * the timeline's. */
const notAdded = (add: TimelineAddition, reason: string): RecorderWarning => {
  const lost =
    add.kind === "interaction"
      ? `A step is missing from the recording: ${stepOf(add.interaction.report)}. The trace still holds it.`
      : `Something may be missing from the recording: the recorder could not add to its timeline (${add.kind}). The trace still holds what happened.`;
  return {
    kind: "notRecorded",
    message: `${lost} The recorder's error: ${reason}`,
  };
};

/** A step by Playwright's name for it and by its selector, when it has one. */
const stepOf = ({ type, selector }: InteractionReport) =>
  selector === null ? type : `${type} on ${selector}`;

/** That a part of the worker's own work was not done, for a person. */
const notDone = (reason: string): RecorderWarning => ({
  kind: "notRecorded",
  message: `Something may be missing from the recording: the recorder could not do a part of its own work. The recorder's error: ${reason}`,
});

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
        let timeline = new Timeline();
        // The lifecycle saves the storage state as it ends only when the
        // browser has a file for it.
        let state: LifecycleState = {
          ...initialState,
          savesStorage: browser.savesStorage,
        };
        let visits = timeline.visits();
        /** What shows of the lifecycle from outside: the phase, the
         * commands that apply, and the address of the page that is open. */
        const told = () => ({
          ...shown(state),
          commands: offered(state),
          url: openAddress(state),
        });
        /** The warnings told so far, and how many of the timeline's. */
        let warnings: readonly RecorderWarning[] = [];
        let fromTimeline = 0;
        const now = (revision: number): RecorderUpdate => ({
          revision,
          state: { ...told(), visits, warnings },
        });
        let update = now(0);
        let toldNow = JSON.stringify(told());
        const publish = () => {
          visits = timeline.visits();
          update = now(update.revision + 1);
          toldNow = JSON.stringify(told());
          for (const listener of listeners)
            try {
              listener(update);
            } catch {
              // A subscriber that breaks is its own to mend: the others are
              // told all the same, and the recording goes on.
            }
        };
        const tell = (happening: Happening) =>
          Queue.offer(queue, { happening });
        /** Tells them, if the timeline has a Visit or an entry more, and the
         * lifecycle, of what the timeline warned of since. */
        const publishEntries = Effect.gen(function* () {
          if (timeline.visits() !== visits) publish();
          const warned = timeline.warnings();
          // Stryker disable next-line MethodExpression: a warning told again is told once all the same; leaving out those told before only saves the telling
          const news = warned.slice(fromTimeline);
          for (const warning of news)
            yield* tell({ kind: "timelineWarned", warning });
          fromTimeline = warned.length;
        });
        /** The time limit that is running: it is the wrap-up's that
         * started it. */
        let timeLimit: Fiber.Fiber<unknown> | undefined;
        /** The requests whose answer was given a time, with that time
         * running. */
        let timed: {
          readonly request: BrowserRequest;
          readonly time: Fiber.Fiber<unknown>;
        }[] = [];
        /** The answer the lifecycle keeps for a later step. */
        let deferred: Queued["reply"];
        /** The answers the lifecycle keeps by a key of its own. */
        const kept = new Map<string, Queued["reply"]>();
        const give = (to: Queued["reply"], result: CommandResult) =>
          // Every answer the lifecycle gives follows a command, which waits
          // for it: the check is for the type.
          to ? Deferred.succeed(to, result) : Effect.void;

        /** Gives a command's answer, now or as the lifecycle keeps it for
         * later: the one it defers, or one under a key of its own. */
        const answer = Effect.fnUntraced(function* (
          item: Extract<
            ToDo,
            {
              kind:
                | "reply"
                | "deferReply"
                | "replyDeferred"
                | "keepReply"
                | "replyKept";
            }
          >,
          reply: Queued["reply"]
        ) {
          switch (item.kind) {
            case "reply":
              return yield* give(reply, item.result);
            case "deferReply":
              deferred = reply;
              return;
            case "replyDeferred":
              yield* give(deferred, item.result);
              deferred = undefined;
              return;
            // Highlight.
            case "keepReply":
              kept.set(item.key, reply);
              return;
            case "replyKept": {
              const waiting = kept.get(item.key);
              // Stryker disable next-line CallExpression: a key is answered once; forgetting it only frees it
              kept.delete(item.key);
              return yield* give(waiting, item.result);
            }
          }
        });

        /** Hands a request to the browser. An answer that is given a time
         * counts as "could not" once the time has passed: the time runs
         * beside the queue, as a time limit does. */
        const ask = Effect.fnUntraced(function* (
          item: Extract<ToDo, { kind: "browser" }>
        ) {
          // Stryker disable next-line ConditionalExpression: a time started for a request that was given none is ended in the same step, by the rule that ends a time nobody waits for
          if (item.within !== undefined)
            timed.push({
              request: item.ask,
              time: yield* Effect.sleep(item.within).pipe(
                Effect.andThen(
                  tell({
                    kind: "requestFailed",
                    request: item.ask,
                    // Stryker disable next-line StringLiteral: no request that is given a time shows why it failed
                    reason: "The browser did not answer in time.",
                  })
                ),
                Effect.forkScoped
              ),
            });
          return yield* browser.ask(item.ask);
        });

        /** Tells every subscriber of a warning, once. */
        const warn = (warning: RecorderWarning) => {
          const told = warnings.some(
            (one) =>
              one.kind === warning.kind && one.message === warning.message
          );
          if (told) return;
          warnings = [...warnings, warning];
          publish();
        };

        const carryOut = Effect.fnUntraced(function* (
          item: ToDo,
          reply: Queued["reply"]
        ) {
          switch (item.kind) {
            case "reply":
            case "deferReply":
            case "replyDeferred":
            case "keepReply":
            case "replyKept":
              return yield* answer(item, reply);
            case "browser":
              return yield* ask(item);
            case "timeline":
              // An entry is told as soon as it is produced.
              yield* Effect.promise(() => timeline.add(item.add));
              return yield* publishEntries;
            case "startTimeLimit":
              // It runs beside the queue, and ends with the wrap-up it is
              // for, or with the recorder.
              timeLimit = yield* Effect.sleep(item.ms).pipe(
                Effect.andThen(tell({ kind: "timeLimitPassed" })),
                Effect.forkScoped
              );
              return;
            case "save": {
              const createdAt = new Date(yield* Clock.currentTimeMillis);
              const folder = yield* Effect.promise(() =>
                options.save(timeline, createdAt, item.trace ?? null)
              );
              // What changed after the last Interaction is an entry now.
              yield* publishEntries;
              return yield* tell({ kind: "saved", folder });
            }
            case "end":
              return yield* Deferred.succeed(done, item.outcome);
            case "clear":
              // Nothing of the old recording is kept: no Visit, no entry
              // and no element's identity.
              timeline = new Timeline();
              fromTimeline = 0;
              return publish();
            // Highlight.
            case "locate":
              return yield* tell({
                kind: "located",
                highlight: item.highlight,
                target: timeline.liveTarget(item.entry, item.row),
              });
            case "warn":
              return warn(item.warning);
          }
        });

        /**
         * What is done in place of an item that broke while it was carried
         * out, so that the items after it are carried out all the same. The
         * lifecycle has moved its state on already: where it waits for what
         * the item leads to, it is told what it is told when that fails, and
         * decides; where nothing waits, a person is told what was lost.
         */
        const instead = (
          item: ToDo,
          reason: string
        ): Effect.Effect<unknown> => {
          switch (item.kind) {
            case "browser":
              // The request never left: it is answered as the browser
              // answers one it could not carry out.
              return tell({ kind: "requestFailed", request: item.ask, reason });
            // Highlight.
            case "locate":
              // No element is found: the highlight is answered "notFound".
              return tell({
                kind: "located",
                highlight: item.highlight,
                target: null,
              });
            case "save":
              // A package that cannot be written ends the recorder "failed",
              // once the storage state is saved, as at any other end.
              return tell({ kind: "saveFailed", reason });
            case "timeline":
              return Effect.sync(() => warn(notAdded(item.add, reason)));
            // An answer, a time limit, the end, Clear or a warning: none
            // of them asks anything of the timeline or the browser, so none
            // is expected to break, and the lifecycle has no happening for
            // one that did. Each kind is named, so that a new one is given
            // its case here.
            case "reply":
            case "deferReply":
            case "replyDeferred":
            case "keepReply":
            case "replyKept":
            case "startTimeLimit":
            case "end":
            case "clear":
            case "warn":
              return Effect.sync(() => warn(notDone(reason)));
          }
        };

        const handle = Effect.fnUntraced(function* ({
          happening,
          reply,
        }: Queued) {
          const next = step(state, happening);
          state = next.state;
          // Only what shows from outside is told: a phase is one state
          // there, with what a wrap-up leads to and the commands that
          // apply. It is told before the step's list is carried out, so
          // that "saving" shows while the package is written. A step that
          // throws the recording away tells its phase with the empty
          // timeline, in one update: the new phase never shows with the
          // old entries.
          if (
            JSON.stringify(told()) !== toldNow &&
            !next.todo.some((item) => item.kind === "clear")
          )
            publish();
          // Each item is carried out on its own: one that breaks keeps none
          // of those after it from being carried out, such as a held click
          // that is passed on, and ends no recording.
          for (const item of next.todo)
            yield* carryOut(item, reply).pipe(
              Effect.catchDefect((broken) => instead(item, reasonOf(broken)))
            );
          // A time limit is one wrap-up's: once that is over, it must not
          // pass for a later one, which has a limit of its own. One that
          // passed already is in the queue ahead of whatever starts the
          // next wrap-up, and is handled while none is under way.
          if (timeLimit && state.phase !== "wrappingUp") {
            yield* Fiber.interrupt(timeLimit);
            timeLimit = undefined;
          }
          // The same goes for the time an answer was given: once the
          // lifecycle no longer waits for it, it must not pass for a later
          // request of its kind.
          for (const { request, time } of timed)
            if (!awaitsAnswer(state, request)) yield* Fiber.interrupt(time);
          // Stryker disable next-line MethodExpression: a time that was ended is ended again to no effect; dropping it only frees it
          timed = timed.filter(({ request }) => awaitsAnswer(state, request));
        });

        // What the browser told while it started comes before anything that
        // is asked of the recorder: the pages that are open, for one. It is
        // handled before the recorder is handed out, so that its first
        // subscriber is told those pages, and that Record applies.
        for (const happening of yield* Queue.clear(browser.signals))
          yield* handle({ happening });
        // The browser's signals join the queue in the order the browser gave them.
        yield* Queue.take(browser.signals).pipe(
          Effect.flatMap(tell),
          Effect.forever,
          Effect.forkScoped
        );
        // The one worker. An item that breaks is made up for where it is
        // carried out (`instead`). What breaks the worker all the same, as a
        // step of the lifecycle that throws, is the last resort's: the
        // lifecycle is told, and the recorder ends "failed", so nobody waits
        // for an end that cannot come.
        yield* Queue.take(queue).pipe(
          Effect.flatMap(handle),
          Effect.forever,
          Effect.catchCause((cause) => {
            return handle({
              happening: {
                kind: "brokeDown",
                reason: reasonOf(Cause.squash(cause)),
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
