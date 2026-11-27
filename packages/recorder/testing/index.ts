import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Queue } from "effect";
import { TestClock } from "effect/testing";

import type { RecorderWarning, RecordingOutcome } from "../src/contract";
import {
  serveWindow,
  startRecorderOn,
  toolbarBridge,
  type Recorder,
} from "../src/engine";
import { RecordedBrowser } from "../src/session/application";
import type {
  BrowserRequest,
  BrowserSignal,
  HeldInput,
  HighlightTarget,
  InputId,
  Written,
} from "../src/session/domain";
import { STORAGE_SAVE_LIMIT_MS } from "../src/session/domain";
import {
  type ElementLookup,
  type InteractionReport,
  type PageId,
  type SnapshotId,
  type TracePosition,
} from "../src/timeline/domain";

/** Whether the page the scripted browser shows has an element a lookup
 * asks for: by its ref, when the page lists it; a selector, a role and name
 * or a text always find one, as the page has no document to ask. */
const shows = (tree: string, find: ElementLookup) =>
  find.by !== "ref" || tree.includes(`[ref=${find.ref}]`);

/** A report as the test wrote it: the browser hands its refs over here, so
 * they are the report's own from here on. */
const reportAsWritten = (report: Written<InteractionReport>) =>
  report as InteractionReport;

// Test support (ADR-0057): a recorder on a scripted browser, where a
// test plays the browser by hand, with a clock the test moves.

/** What the file of a scripted browser's trace holds. */
export const SCRIPTED_TRACE = "a scripted trace";

/**
 * The remote control of a scripted browser with one page, "page_1".
 *
 * It keeps to the recorded browser's seam as the stock adapter does: a
 * request is taken and returns at once, and its answer is told as a signal. It answers by
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
  asks(request: Written<BrowserRequest>): Promise<void>;
  /** What the page looks like from now on, in the notation of Playwright's
   * AI-mode snapshot. */
  showPage(tree: string): void;
  /** The person clicks, and the page holds the click back: "input_1" is the
   * first one, "input_2" the next. */
  holdClick(): void;
  /** The page is a Settled Page: ends the wait the engine asked for last. */
  settle(): void;
  /** Playwright reports an Interaction. */
  report(report: Written<InteractionReport>): void;
  /** From now on a snapshot the engine asks for is not answered... It
   * carries the address the page was at when it was asked, so one held
   * across `goTo` is a read of the document the page left. */
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
  /** The page goes to another address, in a new document: a click held in
   * the one before can no longer reach it. */
  goTo(url: string): void;
  /** The held inputs that reached a page, in order. */
  readonly passedOn: readonly string[];
  /** The page holds an input back: a click of some count, a key press, or
   * a key typed while an earlier input was held. Numbered as `holdClick`
   * numbers. */
  holdInput(held: HeldInput): void;
  /** The browser warns of something a person should know. */
  warn(warning: RecorderWarning): void;
  /** The person picks an element while Playwright is in its picking mode:
   * Playwright reports the assertion, then leaves picking by itself. */
  pick(report: Written<InteractionReport>): void;
  /** The element the recorder's highlight is drawn on now; null when none
   * is. It is drawn on an element whose ref the page shows now, or that has
   * a selector. */
  readonly highlighted: HighlightTarget | null;
  /** From now on the trace is not told started, kept or thrown away... */
  holdTraceAnswers(): void;
  /** ...until now. */
  releaseTraceAnswers(): void;
  /** From now on the browser answers nothing it is asked, and tells nothing
   * by itself: a browser that hangs. What a test plays by hand is still
   * told. */
  goSilent(): void;
  /** From now on saving the storage state fails, for this reason, as when
   * its file cannot be written. Until then it is saved at once. */
  failStorageSave(reason: string): void;
  /** From now on the browser breaks as it takes a request of this kind, for
   * this reason: the request never leaves, and nothing is told of it. */
  breakOn(kind: BrowserRequest["kind"], reason: string): void;
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
    /** The browser has a file to save its storage state to, as
     * `--save-storage` gives one: the recorder asks for that save as it
     * ends. Off unless set. */
    readonly saveStorage?: boolean;
  } = {}
): Promise<{
  recorder: Recorder;
  browser: ScriptedBrowser;
  /** What a recorded page's toolbar calls with a message, as the stock
   * adapter exposes it to every page. */
  toolbar: (message: unknown) => Promise<unknown>;
  /**
   * Ends the recorder from outside and moves its clock on, a second at a
   * time, until it has ended: whatever was left unanswered runs into its
   * time limit. Rejects when the recorder has not ended once `ms` of its
   * clock have passed. A fixture ends its recorder with it, so that a test
   * that left the browser holding an answer back cannot keep it from ending.
   */
  endWithin: (ms: number) => Promise<RecordingOutcome>;
}> {
  const page = "page_1" as PageId;
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
  let traceAnswersHeld: (() => void)[] | undefined;
  let silent = false;
  let storageFails: string | undefined;
  const breaksOn = new Map<BrowserRequest["kind"], string>();
  let confirmationsHeld: (() => void)[] | undefined;
  const asked: BrowserRequest[] = [];
  const traces: string[] = [];
  /** The snapshots taken, which a stopped trace has positions for. */
  const taken: SnapshotId[] = [];
  // Visits: the document each held input was held in.
  let documents = 0;
  const heldIn = new Map<string, number>();
  const passedOn: string[] = [];
  const waiting: (() => void)[] = [];
  /** Whether Playwright is in its picking mode. */
  let picking = false;
  let highlighted: HighlightTarget | null = null;
  const tell = (signal: BrowserSignal) => {
    Queue.offerUnsafe(signals!, signal);
  };

  /** Tells what came of a trace request, now or when a test lets it. */
  const answerTrace = (told: () => void) => {
    if (traceAnswersHeld) traceAnswersHeld.push(told);
    else told();
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
        // The address the page is at as the read starts, as the stock
        // adapter tells it: a read the page goes elsewhere during is of the
        // document it left.
        const address = url;
        const take = () => {
          taken.push(request.snapshot);
          tell({
            kind: "snapshotTaken",
            snapshot: {
              id: request.snapshot,
              page: request.page,
              url: address,
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
        return answerTrace(() => tell({ kind: "traceStarted" }));
      case "stopTrace": {
        // A thrown-away trace is told gone; a kept one is written, and told
        // of once it is.
        if (!request.keep)
          return answerTrace(() => tell({ kind: "traceDiscarded" }));
        const file = join(tmpdir(), `ayme-scripted-trace-${randomUUID()}.zip`);
        const positions: Record<SnapshotId, TracePosition> = {};
        for (const id of taken)
          positions[id] = String(
            Number(id.split("_")[1]) * 10
          ) as TracePosition;
        void writeFile(file, SCRIPTED_TRACE).then(() => {
          traces.push(file);
          answerTrace(() =>
            tell({ kind: "traceStopped", trace: { file, positions } })
          );
        });
        return;
      }
      case "letInputsThrough":
        // Nothing answers it.
        return;
      case "saveStorage":
        return tell(
          storageFails === undefined
            ? { kind: "storageSaved" }
            : { kind: "requestFailed", request, reason: storageFails }
        );
      // Assert visibility.
      case "pick":
        // Playwright tells of its mode only when it changes.
        if (picking === request.on) return;
        picking = request.on;
        return tell({ kind: "picking", on: request.on });
      case "highlight": {
        const { target } = request;
        const found = target !== null && shows(tree, target.find);
        highlighted = found ? target : null;
        if (target)
          tell({ kind: "highlighted", highlight: request.highlight, found });
        return;
      }
    }
  };

  /** Resolves once the engine has asked exactly this. */
  const asks = (request: unknown) =>
    new Promise<void>((resolve) => {
      const wanted = JSON.stringify(request);
      const check = () => {
        if (!asked.some((item) => JSON.stringify(item) === wanted)) return;
        waiting.splice(waiting.indexOf(check), 1);
        resolve();
      };
      waiting.push(check);
      check();
    });

  /** Resolves once the storage state's save is asked, or the recorder has
   * ended; rejects when neither came within ten seconds. */
  const storageSaveAsked = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const missed = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `The recorder asked for no storage save within the first ${ms - STORAGE_SAVE_LIMIT_MS} ms of its clock.`
            )
          ),
        10_000
      );
    });
    const asked = Promise.race([
      asks({ kind: "saveStorage" }),
      recorder.done,
      missed,
    ]).finally(() => clearTimeout(timer));
    asked.catch(() => {});
    return asked;
  };

  const toolbar = toolbarBridge();
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
          savesStorage: options.saveStorage === true,
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request);
              for (const check of [...waiting]) check();
              const broken = breaksOn.get(request.kind);
              if (broken !== undefined) throw new Error(broken);
              if (!silent) answer(request);
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
      toolbar,
    }
  );

  return {
    recorder,
    toolbar: toolbar.answer,
    endWithin: async (ms) => {
      let outcome: RecordingOutcome | undefined;
      void recorder.done.then((ended) => {
        outcome = ended;
      });
      recorder.end();
      /** Lets what the clock set off run, the package's write included. */
      const turn = (wait: number) =>
        new Promise((resolve) => setTimeout(resolve, wait));
      // With --save-storage, the storage state's save is the last of the
      // budget: its time runs from when it is asked, which may wait on the
      // disk, so the clock never moves into it before the ask, or the end.
      // A recorder that asks nothing for ten seconds fails the test.
      const saveAsked = options.saveStorage ? storageSaveAsked(ms) : null;
      for (let passed = 0; passed < ms && !outcome; passed += 1_000) {
        await turn(0);
        if (saveAsked && ms - passed <= STORAGE_SAVE_LIMIT_MS) await saveAsked;
        await Effect.runPromise(clock!.adjust(Math.min(1_000, ms - passed)));
      }
      // The clock has done its part: what is left is the disk's.
      for (let waited = 0; waited < 100 && !outcome; waited += 1)
        await turn(20);
      if (!outcome)
        throw new Error(
          `The recorder had not ended ${ms} ms after it was ended from outside.`
        );
      return outcome;
    },
    browser: {
      goSilent: () => {
        silent = true;
      },
      failStorageSave: (reason) => {
        storageFails = reason;
      },
      breakOn: (kind, reason) => {
        breaksOn.set(kind, reason);
      },
      closePage: ({ pagesLeft }) =>
        tell({ kind: "pageClosed", page, pagesLeft }),
      get released() {
        return released;
      },
      get highlighted() {
        return highlighted;
      },
      asked,
      traces,
      asks,
      showPage: (next) => {
        tree = next;
      },
      holdClick: () => {
        const input = `input_${++inputs}` as InputId;
        heldIn.set(input, documents);
        tell({ kind: "inputHeld", input, page });
      },
      settle: () => {
        if (!settling) throw new Error("The engine waits for no Settled Page.");
        const { page: settled, input } = settling;
        settling = undefined;
        tell({ kind: "pageSettled", page: settled, input });
      },
      report: (report) =>
        tell({
          kind: "interactionReported",
          page,
          report: reportAsWritten(report),
        }),
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
      holdTraceAnswers: () => {
        traceAnswersHeld = [];
      },
      releaseTraceAnswers: () => {
        const held = traceAnswersHeld ?? [];
        traceAnswersHeld = undefined;
        for (const told of held) told();
      },
      goTo: (next) => {
        url = next;
        documents += 1;
        tell({ kind: "pageNavigated", page, url });
      },
      passedOn,
      holdInput: (held) => {
        const input = `input_${++inputs}` as InputId;
        heldIn.set(input, documents);
        tell({ kind: "inputHeld", input, page, held });
      },
      warn: (warning) => tell({ kind: "browserWarned", warning }),
      pick: (report) => {
        tell({
          kind: "interactionReported",
          page,
          report: reportAsWritten(report),
        });
        picking = false;
        tell({ kind: "picking", on: false });
      },
    },
  };
}
