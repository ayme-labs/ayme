import { Effect, Layer, Queue } from "effect";

import { startRecorderOn, type Recorder } from "../engine";
import { RecordedBrowser, type BrowserSignal } from "../session";

// The `./testing` entry (ADR-0026): a recorder on a scripted browser, where a
// test plays the browser by hand.

/** The remote control of a scripted browser. */
export interface ScriptedBrowser {
  /** A page is closed, and `pagesLeft` pages stay open. */
  closePage(options: { pagesLeft: number }): void;
  /** Whether the engine has let the browser go. */
  readonly released: boolean;
}

/** Starts a real recorder on a scripted browser instead of Playwright. */
export async function startScriptedRecorder(): Promise<{
  recorder: Recorder;
  browser: ScriptedBrowser;
}> {
  let signals: Queue.Queue<BrowserSignal> | undefined;
  let released = false;
  const recorder = await startRecorderOn(
    Layer.effect(
      RecordedBrowser,
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<BrowserSignal>();
        signals = queue;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            released = true;
          })
        );
        return RecordedBrowser.of({ signals: queue });
      })
    )
  );
  return {
    recorder,
    browser: {
      closePage: ({ pagesLeft }) => {
        Queue.offerUnsafe(signals!, {
          kind: "pageClosed",
          page: "page_1",
          pagesLeft,
        });
      },
      get released() {
        return released;
      },
    },
  };
}
