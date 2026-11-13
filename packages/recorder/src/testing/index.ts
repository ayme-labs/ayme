import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Queue } from "effect";
import { TestClock } from "effect/testing";

import { serveWindow, startRecorderOn, type Recorder } from "../engine";
import { RecordedBrowser } from "../session/application";
import type {
  BrowserRequest,
  BrowserSignal,
  HeldInput,
} from "../session/domain";
import type { InteractionReport } from "../timeline/domain";

// The `./testing` entry (ADR-0026): a recorder on a scripted browser, where a
// test plays the browser by hand, with a clock the test moves.

/** What the file of a scripted browser's trace holds. */
export const SCRIPTED_TRACE = "a scripted trace";

/**
 * The remote control of a scripted browser with one page, "page_1".
 *
 * It keeps the seam's contract as the stock adapter does: a request is taken
 * and returns at once, and its answer is told as a signal. It answers by
 * itself what a browser answers soon: Interactions being reported, a
 * snapshot, an input passed on, inputs held back or not. A test plays what
 * takes the page's or Playwright's time: a click, the page being settled, a
 * report; and it can keep snapshots back to play a page that is slow to
 * read.
 */
export interface ScriptedBrowser {
  /** A page is closed, and `pagesLeft` pages stay open. */
  closePage(options: { pagesLeft: number }): void;
  /** Whether the engine has let the browser go. */
  readonly released: boolean;
  /** Everything the engine has asked of the browser, in order. */
  readonly asked: readonly BrowserRequest[];
  /** The file of each trace it has handed over, in order. Snapshot number N
   * is at position 10 times N in each of them. */
  readonly traces: readonly string[];
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
  /** From now on the pages do not confirm that they hold inputs back, or
   * that they no longer do... */
  holdConfirmations(): void;
  /** ...until now. */
  releaseConfirmations(): void;
  // Visits.
  /** The page goes to another address, in a new document: a click held in
   * the one before can no longer reach it. */
  goTo(url: string): void;
  /** The held inputs that reached a page, in order. */
  readonly passedOn: readonly string[];
  // Every kind of input.
  /** The page holds an input back: a click of some count, a key press, or
   * a key typed while an earlier input was held. Numbered as `holdClick`
   * numbers. */
  holdInput(held: HeldInput): void;
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
    /** Serve the recorder window, whose built files are in `folder`, as
     * the CLI has the engine do. */
    readonly window?: { readonly folder: string };
  } = {}
): Promise<{
  recorder: Recorder;
  browser: ScriptedBrowser;
}> {
  const page = "page_1";
  let url = options.url ?? "http://scripted.test/";
  let signals: Queue.Queue<BrowserSignal> | undefined;
  let clock: TestClock.TestClock | undefined;
  let released = false;
  let tree = `- generic [ref=e1]: Scripted page`;
  // The browser's clock: it moves by one with everything the browser does.
  let now = 0;
  let inputs = 0;
  let settling: Extract<BrowserRequest, { kind: "waitForSettled" }> | undefined;
  let snapshotsHeld: (() => void)[] | undefined;
  let confirmationsHeld: (() => void)[] | undefined;
  const asked: BrowserRequest[] = [];
  const traces: string[] = [];
  /** The snapshots taken, which a stopped trace has positions for. */
  const taken: string[] = [];
  // Visits: the document each held input was held in.
  let documents = 0;
  const heldIn = new Map<string, number>();
  const passedOn: string[] = [];
  const waiting: (() => void)[] = [];
  const tell = (signal: BrowserSignal) => {
    Queue.offerUnsafe(signals!, signal);
  };

  const answer = (request: BrowserRequest) => {
    switch (request.kind) {
      case "reportInteractions":
        return tell({ kind: "reportingInteractions", on: request.on });
      case "holdInputs": {
        const confirm = () => tell({ kind: "inputsHeld", on: request.on });
        if (confirmationsHeld) confirmationsHeld.push(confirm);
        else confirm();
        return;
      }
      case "takeSnapshot": {
        const take = () => {
          taken.push(request.snapshot);
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
        };
        if (snapshotsHeld) snapshotsHeld.push(take);
        else take();
        return;
      }
      case "passOn":
        if (heldIn.get(request.input) !== documents)
          return tell({ kind: "inputGone", input: request.input });
        passedOn.push(request.input);
        return tell({ kind: "inputPassedOn", input: request.input, at: ++now });
      case "waitForSettled":
        settling = request;
        return;
      case "startTrace":
        return;
      case "stopTrace": {
        // A thrown-away trace is not told of; a kept one is written, and
        // told of once it is.
        if (!request.keep) return;
        const file = join(tmpdir(), `ayme-scripted-trace-${randomUUID()}.zip`);
        const positions = Object.fromEntries(
          taken.map((id) => [id, String(Number(id.split("_")[1]) * 10)])
        );
        void writeFile(file, SCRIPTED_TRACE).then(() => {
          traces.push(file);
          tell({ kind: "traceStopped", trace: { file, positions } });
        });
        return;
      }
      // Every kind of input.
      case "letInputsThrough":
        // Nothing answers it.
        return;
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
      window: options.window
        ? await serveWindow(options.window.folder)
        : undefined,
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
      traces,
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
      holdClick: () => {
        const input = `input_${++inputs}`;
        heldIn.set(input, documents);
        tell({ kind: "inputHeld", input, page });
      },
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
      holdConfirmations: () => {
        confirmationsHeld = [];
      },
      releaseConfirmations: () => {
        const held = confirmationsHeld ?? [];
        confirmationsHeld = undefined;
        for (const confirm of held) confirm();
      },
      goTo: (next) => {
        url = next;
        documents += 1;
        tell({ kind: "pageNavigated", page, url });
      },
      passedOn,
      // Every kind of input.
      holdInput: (held) => {
        const input = `input_${++inputs}`;
        heldIn.set(input, documents);
        tell({ kind: "inputHeld", input, page, held });
      },
    },
  };
}
