import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Queue } from "effect";
import { TestClock } from "effect/testing";

import { startRecorderOn, type Recorder } from "../engine";
import {
  RecordedBrowser,
  type BrowserRequest,
  type BrowserSignal,
} from "../session";
import type { InteractionReport } from "../timeline";

// The `./testing` entry (ADR-0026): a recorder on a scripted browser, where a
// test plays the browser by hand, with a clock the test moves.

/**
 * The remote control of a scripted browser with one page, "page_1".
 *
 * It answers by itself what a browser answers at once: a snapshot, an input
 * passed on, inputs held back or not. A test plays what takes the page's or
 * Playwright's time: a click, the page being settled, a report.
 */
export interface ScriptedBrowser {
  /** A page is closed, and `pagesLeft` pages stay open. */
  closePage(options: { pagesLeft: number }): void;
  /** Whether the engine has let the browser go. */
  readonly released: boolean;
  /** Everything the engine has asked of the browser, in order. */
  readonly asked: readonly BrowserRequest[];
  /** Resolves once the engine has asked exactly this. */
  asks(request: BrowserRequest): Promise<void>;
  /** What the page looks like from now on, in the notation of Playwright's
   * AI-mode snapshot. */
  showPage(tree: string): void;
  /** The person clicks, and the page holds the click back: "input_1" is the
   * first one, "input_2" the next. */
  holdClick(): void;
  /** The page is a Settled Page: ends the wait the engine asked for last. */
  settle(): void;
  /** Playwright reports an Interaction. */
  report(report: InteractionReport): void;
  /** From now on a snapshot the engine asks for is not answered... */
  holdSnapshots(): void;
  /** ...until now. */
  releaseSnapshots(): void;
  /** Moves the recorder's clock on. */
  advanceTime(ms: number): Promise<void>;
}

/** Starts a real recorder on a scripted browser instead of Playwright. Its
 * clock stands at zero until a test moves it. */
export async function startScriptedRecorder(
  options: {
    /** Where a recording is saved. A test that saves one gives a folder of
     * its own. */
    readonly projectDir?: string;
    /** The address of the browser's one page. */
    readonly url?: string;
  } = {}
): Promise<{
  recorder: Recorder;
  browser: ScriptedBrowser;
}> {
  const page = "page_1";
  const url = options.url ?? "http://scripted.test/";
  let signals: Queue.Queue<BrowserSignal> | undefined;
  let clock: TestClock.TestClock | undefined;
  let released = false;
  let tree = `- generic [ref=e1]: Scripted page`;
  // The browser's clock: it moves by one with everything the browser does.
  let now = 0;
  let inputs = 0;
  let settling: Extract<BrowserRequest, { kind: "waitForSettled" }> | undefined;
  let snapshotsHeld: (() => void)[] | undefined;
  const asked: BrowserRequest[] = [];
  const waiting: (() => void)[] = [];
  const tell = (signal: BrowserSignal) => {
    Queue.offerUnsafe(signals!, signal);
  };

  const answer = (request: BrowserRequest) => {
    switch (request.kind) {
      case "reportInteractions":
        return;
      case "holdInputs":
        return tell({ kind: "inputsHeld", on: request.on });
      case "takeSnapshot": {
        const take = () =>
          tell({
            kind: "snapshotTaken",
            snapshot: {
              id: request.snapshot,
              page: request.page,
              url,
              at: ++now,
              tree,
            },
          });
        if (snapshotsHeld) snapshotsHeld.push(take);
        else take();
        return;
      }
      case "passOn":
        return tell({ kind: "inputPassedOn", input: request.input, at: ++now });
      case "waitForSettled":
        settling = request;
    }
  };

  const recorder = await startRecorderOn(
    Layer.effect(
      RecordedBrowser,
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<BrowserSignal>();
        signals = queue;
        clock = yield* TestClock.testClockWith(Effect.succeed);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            released = true;
          })
        );
        tell({ kind: "pageOpened", page, url });
        return RecordedBrowser.of({
          signals: queue,
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request);
              answer(request);
              for (const check of [...waiting]) check();
            }),
        });
      })
    ).pipe(Layer.provideMerge(TestClock.layer())),
    {
      projectDir:
        options.projectDir ?? join(tmpdir(), "ayme-recorder-scripted"),
    }
  );

  return {
    recorder,
    browser: {
      closePage: ({ pagesLeft }) =>
        tell({ kind: "pageClosed", page, pagesLeft }),
      get released() {
        return released;
      },
      asked,
      asks: (request) =>
        new Promise((resolve) => {
          const wanted = JSON.stringify(request);
          const check = () => {
            if (!asked.some((item) => JSON.stringify(item) === wanted)) return;
            waiting.splice(waiting.indexOf(check), 1);
            resolve();
          };
          waiting.push(check);
          check();
        }),
      showPage: (next) => {
        tree = next;
      },
      holdClick: () =>
        tell({ kind: "inputHeld", input: `input_${++inputs}`, page }),
      settle: () => {
        if (!settling) throw new Error("The engine waits for no Settled Page.");
        const { page: settled, input } = settling;
        settling = undefined;
        tell({ kind: "pageSettled", page: settled, input });
      },
      report: (report) => tell({ kind: "interactionReported", page, report }),
      holdSnapshots: () => {
        snapshotsHeld = [];
      },
      releaseSnapshots: () => {
        const held = snapshotsHeld ?? [];
        snapshotsHeld = undefined;
        for (const take of held) take();
      },
      advanceTime: (ms) => Effect.runPromise(clock!.adjust(ms)),
    },
  };
}
