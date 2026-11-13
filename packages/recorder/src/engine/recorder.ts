import { Layer, ManagedRuntime, type Effect } from "effect";

import type {
  CommandResult,
  RecorderCommand,
  RecorderUpdate,
  RecordingOutcome,
} from "../contract";
import { RecorderSession, type RecordedBrowser } from "../session/application";
import type { RecorderStartError } from "../session/domain";
import { saveRecording } from "../timeline/infrastructure";

/** One started recorder. Promises, callbacks and plain data only. */
export interface Recorder {
  /** The local address of the recorder window; null while none is served. */
  readonly windowUrl: string | null;
  /** Asks something of the recorder. One that does not apply now is answered
   * "ignored" and changes nothing. */
  send(command: RecorderCommand): Promise<CommandResult>;
  /** Calls the listener at once with the full state, then with every change.
   * Returns "unsubscribe". */
  subscribe(listener: (update: RecorderUpdate) => void): () => void;
  /** Ends the recorder from outside, as the terminal's stop does. Calling it
   * again, at any time, is harmless. */
  end(): void;
  /** Resolves when the recorder has ended, whoever ended it, and its browser
   * is let go. It never rejects: a recorder that broke down after it had
   * started ends with the outcome "failed". */
  readonly done: Promise<RecordingOutcome>;
}

/**
 * Starts a recorder on a recorded browser and turns it into the handle a
 * caller gets: the one place Effect becomes promises.
 */
export async function startRecorderOn(
  browser: Layer.Layer<RecordedBrowser, RecorderStartError>,
  options: {
    /** The project's folder: a recording is saved in it. */
    readonly projectDir: string;
  }
): Promise<Recorder> {
  const runtime = ManagedRuntime.make(
    RecorderSession.layer({
      // The composition root says where a package is kept: on the disk, in
      // the project.
      save: (timeline, createdAt, trace) =>
        saveRecording(timeline, {
          projectDir: options.projectDir,
          createdAt,
          trace,
        }),
    }).pipe(Layer.provide(browser))
  );
  // A failed start rejects with what failed: the start error itself.
  const session = await runtime
    .runPromise(RecorderSession)
    .catch(async (error: unknown) => {
      await runtime.dispose();
      throw error;
    });
  // The runtime is closed once the recorder has ended: that lets the browser
  // go. Nothing runs on it after, so what is asked then is answered here.
  let ended = false;
  const done = runtime.runPromise(session.done).then(async (outcome) => {
    ended = true;
    await runtime.dispose();
    return outcome;
  });
  const run = <A>(effect: Effect.Effect<A>, afterTheEnd: A): Promise<A> =>
    ended ? Promise.resolve(afterTheEnd) : runtime.runPromise(effect);
  return {
    windowUrl: null,
    send: (command) => run(session.send(command), "ignored"),
    subscribe: session.subscribe,
    end: () => void run(session.end, undefined),
    done,
  };
}
