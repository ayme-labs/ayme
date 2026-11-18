import {
  AriaRefSchema,
  MonotonicTimeMsSchema,
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type PageActivitySource,
} from "@ayme-dev/core/structural-observation";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Queue } from "effect";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Frame,
  Locator,
  Page,
} from "playwright-core";

import type { ToolbarBinding } from "../../../contract";
import { RecordedBrowser } from "../../../session/application";
import {
  RecorderStartError,
  type BrowserRequest,
  type BrowserSignal,
  type InputId,
} from "../../../session/domain";
import {
  pictureRef,
  snapshotRef,
  type ElementLookup,
  type InteractionReport,
  type PageId,
  type SnapshotId,
} from "../../../timeline/domain";
import {
  askRecorderState,
  closeGate,
  fileNamesIn,
  frameContentOffset,
  letGateThrough,
  markCall,
  noLongerRecording,
  openGate,
  pickWithGate,
  removeOwnElements,
  setGate,
  stopGateAndWatch,
  watchActivity,
} from "../in-page/calls";
import {
  hidePlaywrightOverlay,
  keepCursorsAsTheyAre,
  type HighlightBox,
} from "../in-page/drawing";
import { startGate } from "../in-page/gate";
import { installActivityWatch, type TargetChain } from "../in-page/watches";
import { letThroughUpTo, ownRefOf, type HeldByPage } from "../pageRules";
import {
  ancestorRefs,
  followPickingIn,
  highlightIn,
  installGate,
  installTargetWatch,
  startPickingIn,
} from "./pageFunctions";
import {
  playwrightRecorderOf,
  type PlaywrightAction,
} from "../playwrightRecorder";
import {
  attachAddressRule,
  isAttachAddress,
  notOnePageMessage,
} from "../attachAddress";
import {
  loadProjectPlaywright,
  placeInRange,
  projectPlaywrightCli,
  rangeText,
  type Playwright,
} from "../projectPlaywright";
import { snapshotPositions } from "../traceTool";

/** Chromium launched by the project's own Playwright on a URL. */
type Launch = {
  readonly projectDir: string;
  readonly url: string;
  readonly headless: boolean;
  readonly debugPort: number | undefined;
  /** The recorder window's address, opened as a second window of the
   * launched browser; none when no window is served. */
  readonly windowUrl?: string;
  readonly toolbar?: Toolbar;
};

/** A Chromium that is already running, reached at the address of its
 * DevTools protocol. Its page is recorded as it is: never navigated. */
type Attach = {
  readonly projectDir: string;
  readonly cdpEndpoint: string;
  readonly toolbar?: Toolbar;
};

/**
 * The in-page toolbar, which every recorded document gets: its script, and
 * what answers the one page function it calls. The adapter carries the two
 * between the page and the engine and knows nothing else of the toolbar.
 */
type Toolbar = {
  readonly script: string;
  readonly answer: (message: unknown) => Promise<unknown>;
};

/**
 * The recorded browser on stock Playwright: Chromium, launched by the
 * project's own Playwright on a URL, or a running one it attaches to.
 * Closing the layer's scope closes a launched browser, and lets go of an
 * attached one, which stays open.
 */
export const stockBrowser = (
  options: Launch | Attach
): Layer.Layer<RecordedBrowser, RecorderStartError> =>
  Layer.effect(
    RecordedBrowser,
    Effect.gen(function* () {
      const attach = "cdpEndpoint" in options ? options : undefined;
      if (attach && !isAttachAddress(attach.cdpEndpoint))
        return yield* Effect.fail(
          new RecorderStartError(
            "browser-unavailable",
            attachAddressRule(attach.cdpEndpoint)
          )
        );
      const { playwright, version } = yield* loadProjectPlaywright(
        options.projectDir
      );
      const signals = yield* Queue.unbounded<BrowserSignal>();
      const unavailable = (cause: unknown) =>
        new RecorderStartError(
          "browser-unavailable",
          cause instanceof NotOnePage
            ? cause.message
            : `${attach ? `Playwright could not connect to the browser at ${attach.cdpEndpoint}.` : "Playwright could not open Chromium."} ${cause instanceof Error ? cause.message : String(cause)}`
        );
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            attach
              ? playwright.chromium.connectOverCDP(attach.cdpEndpoint, {
                  // The browser is someone else's: its settings stay as
                  // they are.
                  noDefaults: true,
                })
              : launchIn(playwright, options as Launch),
          catch: unavailable,
        }),
        // A launched browser the person already closed has nothing left to
        // close. An attached one is only let go: Playwright closes its
        // connection, not the browser.
        (browser) => Effect.promise(() => browser.close().catch(() => {}))
      );
      const recorded = yield* Effect.tryPromise({
        try: () =>
          openPage(
            browser,
            attach ? { attached: true } : { url: (options as Launch).url },
            options.projectDir,
            (signal) => Queue.offerUnsafe(signals, signal),
            options.toolbar
          ),
        catch: (cause) =>
          cause instanceof NoPlaywrightRecorder
            ? new RecorderStartError(
                "playwright-recorder-not-found",
                `The recorder could not find Playwright's own recorder in Playwright ${version}, in ${options.projectDir}. It needs ${rangeText}.`
              )
            : unavailable(cause),
      });
      // Warnings.
      if (placeInRange(version) === "above")
        Queue.offerUnsafe(signals, {
          kind: "browserWarned",
          warning: {
            kind: "playwrightUnverified",
            message: `Playwright ${version} is newer than the recorder is verified on: it needs ${rangeText}. It records all the same, and may miss or misread an input.`,
          },
        });
      // Before its connection closes, an attached browser is put back as
      // it was found: it stays open, in someone else's hands.
      if (attach)
        yield* Effect.addFinalizer(() => Effect.promise(recorded.letGo));
      else if ((options as Launch).windowUrl)
        openWindow(browser, (options as Launch).windowUrl!);
      return RecordedBrowser.of({
        signals,
        // Handed over, never waited on: the answer is told as a signal, and
        // so is a request that broke while it was carried out. One for a
        // page that is gone is answered by nothing: the page's closing was
        // told.
        ask: (request) =>
          Effect.sync(() => {
            void recorded.carryOut(request).catch((cause: unknown) =>
              Queue.offerUnsafe(signals, {
                kind: "requestFailed",
                request,
                reason: cause instanceof Error ? cause.message : String(cause),
              })
            );
          }),
      });
    })
  );

/** Launches Chromium for the recorder with the project's Playwright. */
const launchIn = (playwright: Playwright, options: Launch) =>
  playwright.chromium.launch({
    headless: options.headless,
    args:
      options.debugPort === undefined
        ? []
        : [`--remote-debugging-port=${options.debugPort}`],
    // Terminal signals belong to the CLI, which ends the recorder.
    // Left on, Playwright would exit the process on the first one.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

/**
 * Opens the recorder window as a second window of a browser the recorder
 * launched: a page in a context of its own. The recorded context's page
 * hooks, Playwright's recorder and the trace are all that context's, so the
 * window is never recorded, snapshotted or traced, and its closing is no
 * page of the recording closing. It is a convenience: the address is
 * printed all the same, so a window that cannot open is no reason to stop.
 */
function openWindow(browser: Browser, url: string): void {
  void browser
    .newContext({ viewport: null })
    .then((context) => context.newPage())
    .then((page) => page.goto(url))
    .catch(() => {});
}

/** Milliseconds on the clock Playwright's own times are on. */
const now = () => Math.floor(performance.now() * 1e3) / 1e3;

/** This Playwright has no recorder the engine knows how to start. */
class NoPlaywrightRecorder extends Error {}

/** The running browser has not exactly one page to record. */
class NotOnePage extends Error {}

/**
 * The page the recorder records in a browser it attached to: the one page
 * open in it. A context with no page, as the default context of a browser a
 * Playwright test started, does not count. With more pages, or none, it
 * does not guess, as the released recorder does not.
 */
function theOnePage(browser: Browser): Page {
  const pages = browser.contexts().flatMap((context) => context.pages());
  if (pages.length === 1) return pages[0]!;
  throw new NotOnePage(notOnePageMessage(pages.length));
}

/**
 * Playwright's recorder as it runs beside the context, with the mode it is
 * in: a private part of Playwright. "recording" reports Interactions, and
 * "none" reports nothing and leaves the page's input alone.
 */
type PlaywrightRecorderMode = {
  mode(): string;
  setMode(mode: "none" | "recording" | typeof PICKING_MODE): Promise<void>;
  /** Tells of each change of the mode, whoever made it. Without it, Assert
   * visibility is never shown on. */
  on?(event: "modeChanged", listener: (mode: string) => void): void;
};

/**
 * Reaches the recorder Playwright started on a context, on the connection
 * the context is on: Playwright keeps it under a symbol of its own.
 */
async function recorderModeOf(
  context: BrowserContext
): Promise<PlaywrightRecorderMode> {
  const server = (
    context as unknown as {
      _connection: { toImpl?(client: unknown): object | undefined };
    }
  )._connection.toImpl?.(context);
  const key =
    server &&
    Object.getOwnPropertySymbols(server).find(
      (symbol) => symbol.description === "recorderSymbol"
    );
  const recorder = key
    ? await (
        server as Record<symbol, Promise<Partial<PlaywrightRecorderMode>>>
      )[key]
    : undefined;
  if (
    typeof recorder?.setMode !== "function" ||
    typeof recorder.mode !== "function"
  )
    throw new Error("Playwright's recorder has no mode to switch.");
  return recorder as PlaywrightRecorderMode;
}

/**
 * Opens the context and its page, and returns what carries out the engine's
 * requests on them. It decides nothing: each request is one thing done, and
 * `tell` says what came of it. Requests are carried out as they come, side
 * by side: the lifecycle asks for the next of two that must follow each
 * other only when the first is answered.
 */
async function openPage(
  browser: Browser,
  start: { readonly url: string } | { readonly attached: true },
  projectDir: string,
  tell: (signal: BrowserSignal) => void,
  toolbar: Toolbar | undefined
) {
  browser.on("disconnected", () => tell({ kind: "browserGone" }));
  const context =
    "url" in start
      ? // No fixed viewport: the page has the size of its window.
        await browser.newContext({ viewport: null })
      : theOnePage(browser).context();
  const startRecording = playwrightRecorderOf(context);
  if (!startRecording) throw new NoPlaywrightRecorder();

  const pages = new Map<PageId, Page>();
  const idOf = new Map<Page, PageId>();
  /** The inputs the pages hold back, until they are passed on. */
  const held = new Map<InputId, { frame: Frame; input: HeldByPage }>();
  /** Every input a page held, in order: which document held it, and its
   * number there. */
  const heldBy = new Map<
    PageId,
    { id: InputId; frame: Frame; seq: number }[]
  >();
  let inputs = 0;
  /** How often the gate was switched. */
  let gateChanges = 0;
  /** How often Playwright's recorder started or stopped picking. */
  let pickingChanges = 0;

  const track = (page: Page) => {
    const id = `page_${idOf.size + 1}` as PageId;
    pages.set(id, page);
    idOf.set(page, id);
    tell({ kind: "pageOpened", page: id, url: page.url() });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame())
        tell({ kind: "pageNavigated", page: id, url: frame.url() });
    });
    page.on("close", () => {
      pages.delete(id);
      tell({ kind: "pageClosed", page: id, pagesLeft: context.pages().length });
    });
  };
  context.on("page", track);
  // An attached browser's page is open already: no "page" event tells of it.
  for (const open of context.pages()) track(open);

  const heldBinding = "__aymeRecorderHeld";
  await context.exposeBinding(
    heldBinding,
    ({ page, frame }, input: HeldByPage) => {
      const pageId = idOf.get(page);
      if (!pageId) return;
      const id = `input_${++inputs}` as InputId;
      held.set(id, { frame, input });
      heldBy.set(pageId, [
        ...(heldBy.get(pageId) ?? []),
        { id, frame, seq: input.seq },
      ]);
      tell({
        kind: "inputHeld",
        input: id,
        page: pageId,
        held:
          input.kind === "click"
            ? { kind: "click", count: Math.max(1, input.detail) }
            : input.typing
              ? { kind: "typing" }
              : { kind: "press", nothingFocused: input.nothingFocused },
      });
    }
  );
  /** Who hears of a page's activity now: a wait for a Settled Page. */
  const listening = new Map<Page, Set<() => void>>();
  const changedBinding = "__aymeRecorderChanged";
  await context.exposeBinding(changedBinding, ({ page }) => {
    for (const heard of listening.get(page) ?? []) heard();
  });
  /** The latest targets each page told of. */
  const chains = new Map<Page, TargetChain[]>();
  const chainBinding = "__aymeRecorderTarget";
  await context.exposeBinding(chainBinding, ({ page }, seen: TargetChain) => {
    chains.set(page, [...(chains.get(page) ?? []).slice(-9), seen]);
  });
  /**
   * A report, with the element the input acted on, as Playwright's selector
   * names it: a link or a button rather than the element inside it that
   * was under the pointer, whose ref is the one Playwright's report gives.
   * The page's note of the input says which element that is: the note whose
   * element under the pointer is the one Playwright's ref names, so that it
   * is this input's own. Without that note, a mouse input is read through
   * the selector (`fromSelector`, for `withAncestors`), with Playwright's
   * ref standing if it cannot be; a field and a focused element are what
   * typing and keys act on, so their ref is Playwright's. A report whose
   * picture does not list the element under the pointer is read through the
   * selector too, with the page's latest note standing.
   */
  const reportFrom = (
    page: Page,
    action: PlaywrightAction
  ): { report: InteractionReport; fromSelector: boolean } => {
    const report = reportOf(action);
    const tree = action.ariaSnapshot;
    if (!tree) return { report, fromSelector: false };
    const types = CHAIN_TYPES[action.name] ?? [];
    const told = (chains.get(page) ?? []).filter((chain) =>
      types.includes(chain.type)
    );
    if (action.ref && listedIn(tree, action.ref)) {
      const own = told.findLast((chain) => chain.under === action.ref);
      if (own)
        return {
          report: { ...report, target: namedIn(tree, own.chain) },
          fromSelector: false,
        };
      return { report, fromSelector: MOUSE_REPORTS.has(action.name) };
    }
    const latest = told.at(-1);
    return {
      report: {
        ...report,
        target: latest
          ? namedIn(tree, latest.chain)
          : { ref: null, tree, ancestors: [] },
      },
      fromSelector: true,
    };
  };
  /**
   * The element an input acted on and its ancestors, for a report that
   * came before the page's own note of them: read off the element
   * Playwright's selector names, nearest first, itself included. The refs
   * Playwright's recorder tagged them with (`_ariaRef`, a private part of
   * Playwright) stay on them, so they are there however late the report
   * comes. When the element is gone, Playwright's own ref stands.
   */
  /**
   * For an assertion, which Playwright reports by a selector alone: the ref
   * the adapter's own snapshots give the picked element, or its nearest
   * ancestor they list, read off a public snapshot of each in turn. Its
   * snapshot names it as it names a click's target.
   */
  const withPickedRef = async (
    report: InteractionReport,
    page: Page
  ): Promise<InteractionReport> => {
    const { selector } = report;
    if (report.type !== "assertVisible" || selector === null) return report;
    // Calls Playwright traces: never inside a snapshot's mark.
    const read = markers.then(() => pickedRef(page.locator(selector)));
    markers = read.catch(() => {});
    const ref = await read;
    return ref
      ? { ...report, snapshotTarget: snapshotRef(AriaRefSchema.parse(ref)) }
      : report;
  };
  const withAncestors = async (
    report: InteractionReport,
    page: Page,
    fromSelector: boolean
  ): Promise<InteractionReport> => {
    const { target, selector } = report;
    if (!fromSelector || !target || selector === null) return report;
    // A call Playwright traces: never inside a snapshot's mark.
    const read = markers.then(() =>
      page
        .locator(selector)
        .evaluate(ancestorRefs, undefined, { timeout: ANCESTOR_READ_MS })
        .catch(() => null)
    );
    markers = read.catch(() => {});
    const refs = await read;
    if (!refs) return report;
    return { ...report, target: namedIn(target.tree, refs) };
  };
  /**
   * Files chosen in a file input, which Playwright 1.64 reports as typing
   * of the input's value, as an upload. A file input's value is always
   * `C:\fakepath\` and the first file's name (HTML's rule for it). The
   * names of all files are the input's own state, set before the event
   * that Playwright reports: they are read from the input itself, however
   * late the report comes. An input that can no longer be read, or that
   * holds other files by then, leaves the first name only, and a warning.
   */
  const asUpload = async (
    report: InteractionReport,
    page: Page
  ): Promise<InteractionReport> => {
    const first = firstFileOf(report);
    if (first === undefined || report.selector === null) return report;
    const { selector } = report;
    const { text, ...values } = report.values;
    void text;
    // A call Playwright traces: never inside a snapshot's mark.
    const read = markers.then(() =>
      page
        .locator(selector)
        .evaluate(fileNamesIn, undefined, { timeout: UPLOAD_READ_MS })
        .catch(() => null)
    );
    markers = read.catch(() => {});
    const names = await read;
    if (names?.[0] !== first)
      tell({
        kind: "browserWarned",
        warning: {
          kind: "uploadNamesUnknown",
          message: `The names of the files chosen in ${selector} could not all be read: the upload is recorded with the first, ${first}.`,
        },
      });
    return {
      ...report,
      type: "setInputFiles",
      values: {
        ...values,
        files: names?.[0] === first ? names : [first],
      },
    };
  };
  /** Reports are told in the order Playwright gave them, also when one
   * waits for what is read of its target. */
  let reports: Promise<unknown> = Promise.resolve();
  const inReportOrder = (make: () => Promise<BrowserSignal>) => {
    reports = reports.then(make).then(tell, () => {});
  };
  await context.addInitScript(installTargetWatch, chainBinding);
  // Every document gets the gate and the activity watch, both switched off,
  // before its own scripts run.
  await context.addInitScript(installGate, heldBinding);
  await context.addInitScript(installActivityWatch, changedBinding);
  await context.addInitScript(hidePlaywrightOverlay);
  await context.addInitScript(keepCursorsAsTheyAre);
  // The toolbar's page function first, then its script: each document
  // shows it before it first paints, and before Playwright's own overlay
  // could.
  if (toolbar) {
    await context.exposeBinding(TOOLBAR_BINDING, (_source, message: unknown) =>
      toolbar.answer(message)
    );
    await context.addInitScript({ content: toolbar.script });
  }

  /**
   * A page's activity, for core's wait (ADR-0024): every change to the
   * elements of any of its frames, and every document one of its frames
   * goes to or finishes loading. It says only that something happened.
   */
  const activityOf = (page: Page): PageActivitySource => ({
    subscribe(onActivity) {
      const watch = (frame: Frame, on: boolean) =>
        // A frame that is gone has nothing to tell.
        void frame.evaluate(watchActivity, on).catch(() => {});
      const onNavigated = (frame: Frame) => {
        onActivity();
        // Its new document starts with the watch switched off.
        watch(frame, true);
      };
      const heard = listening.get(page) ?? new Set();
      listening.set(page, heard.add(onActivity));
      page.on("framenavigated", onNavigated);
      page.on("domcontentloaded", onActivity);
      page.on("load", onActivity);
      for (const frame of page.frames()) watch(frame, true);
      return () => {
        heard.delete(onActivity);
        page.off("framenavigated", onNavigated);
        page.off("domcontentloaded", onActivity);
        page.off("load", onActivity);
        // Another wait on this page may still be listening.
        if (heard.size === 0)
          for (const frame of page.frames()) watch(frame, false);
      };
    },
  });

  const everyFrame = () => [...pages.values()].flatMap((open) => open.frames());

  if ("url" in start) {
    const page = await context.newPage();
    // A page that does not load is no reason to stop: the browser shows the
    // error, and the person can go elsewhere or close it.
    await page.goto(start.url).catch(() => {});
  } else {
    // Scripts for new documents never run in one that is loaded already:
    // the attached page's documents get them now, the same way.
    await Promise.all(
      everyFrame().map((frame) =>
        Promise.all([
          frame.evaluate(installGate, heldBinding),
          frame.evaluate(installActivityWatch, changedBinding),
          frame.evaluate(hidePlaywrightOverlay),
          frame.evaluate(keepCursorsAsTheyAre),
          // It shows only in the top document, and leaves the others be.
          ...(toolbar && !frame.parentFrame()
            ? [frame.evaluate(toolbar.script)]
            : []),
        ]).catch(() => {})
      )
    );
  }

  /**
   * Playwright groups every call of a context, so what is traced is done
   * one at a time: a snapshot's mark, and the read of an upload's files,
   * which is a traced call that must not land inside a mark. This is no
   * order of the engine's requests, which the lifecycle decides: the
   * engine asks for a trace to start before it asks for a mark, and for the
   * next trace only when the last is told gone. It is the one context-wide
   * resource that two things the engine cannot see, a mark and a read the
   * adapter makes by itself, would otherwise share.
   */
  let markers: Promise<unknown> = Promise.resolve();
  /** The snapshots a mark was made for. A trace that is thrown away leaves
   * its ids here: the next one looks for them in its own list of actions,
   * where only the marks it made are. */
  const marked = new Set<SnapshotId>();

  /**
   * Leaves a mark in the trace for a snapshot just read: a group named for
   * the snapshot's id with one call inside it, whose page the stock trace
   * tool opens as the page at that moment. It changes nothing in the page.
   * A mark that cannot be made leaves the snapshot without a place in the
   * trace, and is no reason to lose the snapshot.
   */
  async function mark(page: Page, snapshot: SnapshotId) {
    marked.add(snapshot);
    const made = markers.then(async () => {
      await context.tracing.group(snapshot);
      try {
        await page.evaluate(markCall);
      } finally {
        await context.tracing.groupEnd();
      }
    });
    markers = made.catch(() => {});
    await made.catch(() => {});
  }

  /** The trace is stopped. Kept, it is a file with the place of each mark
   * in it, as the stock trace tool numbers them. */
  async function stopTrace(keep: boolean) {
    if (!keep) {
      await context.tracing.stop();
      return tell({ kind: "traceDiscarded" });
    }
    const file = join(
      await mkdtemp(join(tmpdir(), "ayme-recorder-")),
      "trace.zip"
    );
    await context.tracing.stop({ path: file });
    const cli = projectPlaywrightCli(projectDir);
    const positions = cli ? await snapshotPositions(cli, file, marked) : {};
    // Warnings.
    if (Object.keys(positions).length < marked.size)
      tell({
        kind: "browserWarned",
        warning: {
          kind: "traceWithoutPositions",
          message:
            "The project's `playwright trace` could not number the trace's snapshots: the package carries its trace, but not the position numbers that open them.",
        },
      });
    tell({ kind: "traceStopped", trace: { file, positions } });
  }

  /** One request of a kind. */
  type Asked<K extends BrowserRequest["kind"]> = Extract<
    BrowserRequest,
    { kind: K }
  >;

  async function carryOut(request: BrowserRequest): Promise<void> {
    switch (request.kind) {
      case "reportInteractions":
        return reportInteractions(request.on);
      case "holdInputs":
        return holdInputs(request.on);
      case "takeSnapshot":
        return takeSnapshot(request);
      case "passOn":
        return passOnHeld(request.input);
      case "letInputsThrough":
        return letInputsThrough(request);
      case "startTrace":
        return startTrace();
      case "stopTrace":
        return stopTrace(request.keep);
      // Assert visibility.
      case "pick":
        return pick(request.on);
      // Highlight.
      case "highlight":
        return highlight(request);
      case "waitForSettled":
        return settle(request);
    }
  }

  async function holdInputs(on: boolean) {
    // A document that starts from now on starts so.
    await context.addInitScript(startGate, { on, change: ++gateChanges });
    // A frame that is gone holds nothing back.
    await Promise.all(
      everyFrame().map((frame) => frame.evaluate(setGate, on).catch(() => {}))
    );
    tell({ kind: "inputsHeld", on });
  }

  async function takeSnapshot(request: Asked<"takeSnapshot">) {
    const open = pages.get(request.page);
    if (!open) return;
    const at = now();
    const tree = await open.ariaSnapshot({ mode: "ai" });
    // Before the snapshot is told: its input is passed on after that.
    await mark(open, request.snapshot);
    tell({
      kind: "snapshotTaken",
      snapshot: {
        id: request.snapshot,
        page: request.page,
        url: open.url(),
        at,
        tree,
      },
    });
  }

  async function passOnHeld(id: InputId) {
    const input = held.get(id);
    held.delete(id);
    if (!input) return;
    if (!(await passOn(input.frame, input.input)))
      return tell({ kind: "inputGone", input: id });
    tell({ kind: "inputPassedOn", input: id, at: now() });
  }

  async function letInputsThrough(request: Asked<"letInputsThrough">) {
    const open = pages.get(request.page);
    if (!open) return;
    // What the engine knows the page held: up to `upTo`, by document.
    const known = heldBy.get(request.page) ?? [];
    await Promise.all(
      open.frames().map((frame) =>
        frame
          .evaluate(
            letGateThrough,
            letThroughUpTo(
              known,
              request.upTo,
              (input) => input.frame === frame
            )
          )
          .catch(() => {})
      )
    );
  }

  async function startTrace() {
    await context.tracing.start({
      name: "ayme-recording",
      snapshots: true,
      screenshots: true,
    });
    tell({ kind: "traceStarted" });
  }

  async function settle(request: Asked<"waitForSettled">) {
    const open = pages.get(request.page);
    // Core owns the quiet window, the deadline and what "settled" is.
    if (open)
      await waitForSettled({
        activity: activityOf(open),
        clock: {
          now: () => MonotonicTimeMsSchema.parse(performance.now()),
        },
        quietMs: SETTLED_PAGE_QUIET_MS,
        deadlineMs: SETTLED_PAGE_DEADLINE_MS,
      });
    tell({ kind: "pageSettled", page: request.page, input: request.input });
  }

  /** Playwright's recorder, once it has been started on the context. */
  let recorderMode: PlaywrightRecorderMode | undefined;

  /**
   * Switches Playwright's recorder on or off by its mode. It is started
   * once and never stopped: on Playwright 1.62 a recorder that was stopped
   * and started again on the same context reports nothing afterwards.
   * Switching the mode leaves a trace that is being recorded alone.
   */
  async function reportInteractions(on: boolean) {
    // A click made just before is reported before the answer, not after:
    // what every document already told Playwright's recorder reaches it
    // first. Switching off reports a click it holds back to see whether a
    // double click follows (1.63 and later; 1.62 holds nothing back).
    if (recorderMode && !on) await everyReportDelivered();
    if (recorderMode) {
      await inModeOrder(() => recorderMode!.setMode(on ? "recording" : "none"));
      // A report that is still being read, as through its selector, is
      // told before the answer too.
      if (!on) await reports;
    } else if (on) {
      await startPlaywrightRecorder();
      recorderMode = await recorderModeOf(context);
      // Whether it picks, whoever switched it: told when it changes.
      let picking = false;
      recorderMode.on?.("modeChanged", (mode) => {
        if ((mode === PICKING_MODE) === picking) return;
        picking = mode === PICKING_MODE;
        // A document that loads from now on outlines what it would pick
        // while picking, and nothing after: told once that holds.
        // A document open now stops outlining when picking ends, whoever
        // ended it.
        const on = picking;
        const open = on
          ? []
          : everyFrame().map((frame) =>
              frame.evaluate(followPickingIn, false).catch(() => {})
            );
        void Promise.all([
          ...open,
          context
            .addInitScript(startPickingIn, { on, change: ++pickingChanges })
            .catch(() => {}),
        ]).then(() => tell({ kind: "picking", on }));
      });
    }
    tell({ kind: "reportingInteractions", on });
  }

  /**
   * Resolves once what every document has told Playwright's recorder so far
   * has reached it. A document's report travels on its own way to
   * Playwright, which on a browser reached over a WebSocket, as an attached
   * one, can be overtaken by a switch-off from here; once switched off,
   * Playwright drops it. Each document asks Playwright's recorder for its
   * state (a private part of Playwright, as `noLongerRecording` says): the
   * answer comes after the document's earlier reports were taken. A call
   * Playwright traces: never inside a snapshot's mark.
   */
  async function everyReportDelivered() {
    const asked = markers.then(() =>
      Promise.all(
        everyFrame().map((frame) =>
          frame.evaluate(askRecorderState).catch(() => {})
        )
      )
    );
    markers = asked.catch(() => {});
    await asked;
  }

  /** The latest highlight asked: only it is drawn. */
  let latestHighlight = 0;
  /** A DevTools session of each page the highlight was drawn in: drawing
   * through it is no call of Playwright, and leaves nothing in the trace. */
  const drawers = new Map<Page, Promise<CDPSession>>();
  const draw = (page: Page, boxes: readonly HighlightBox[] | null) => {
    let drawer = drawers.get(page);
    if (!drawer) {
      drawer = context.newCDPSession(page);
      drawers.set(page, drawer);
    }
    return drawer.then((session) =>
      session.send("Runtime.evaluate", {
        expression: `(${highlightIn.toString()})(${JSON.stringify(boxes)})`,
      })
    );
  };

  /**
   * Draws the highlight on every element the page as it is now gives for a
   * lookup, in place of what was drawn before, and tells whether it found
   * one with a box. Finding them is Playwright's public locator, which the
   * trace records; drawing is not.
   */
  async function highlight(
    request: Extract<BrowserRequest, { kind: "highlight" }>
  ) {
    latestHighlight = Math.max(latestHighlight, request.highlight);
    const latest = () => request.highlight === latestHighlight;
    await Promise.all(
      [...drawers.keys()]
        .filter((page) => !page.isClosed())
        .map((page) => draw(page, null).catch(() => {}))
    );
    const { target } = request;
    if (!target) return;
    const found = (boxes: readonly HighlightBox[]) =>
      tell({
        kind: "highlighted",
        highlight: request.highlight,
        found: boxes.length > 0,
      });
    const open = pages.get(target.page);
    if (!open || !latest()) return found([]);
    const elements = await matchesOf(open, target.find);
    const boxes = (
      await Promise.all(
        elements.map((element) =>
          element
            .boundingBox({ timeout: HIGHLIGHT_LOOKUP_MS })
            .catch(() => null)
        )
      )
    ).filter((box): box is HighlightBox => box !== null);
    // A later highlight replaced it meanwhile: it is not drawn.
    if (boxes.length === 0 || !latest()) return found([]);
    await draw(open, boxes);
    found(boxes);
  }

  /** Switching the mode of Playwright's recorder, one after the other, in
   * the order asked: picking that is left right after it is asked ends
   * left. */
  let modeChanges: Promise<unknown> = Promise.resolve();
  const inModeOrder = (run: () => Promise<void>): Promise<void> => {
    const done = modeChanges.then(run);
    modeChanges = done.catch(() => {});
    return done;
  };

  /**
   * Has Playwright's recorder pick an element, or stop picking, and every
   * document leave inputs alone meanwhile. Playwright's recorder must be
   * reporting: it picks only from its recording mode, and goes back to it.
   */
  async function pick(on: boolean) {
    // Each document leaves its inputs to picking, and outlines what it
    // would pick.
    const gates = (picking: boolean) =>
      Promise.all(
        everyFrame().flatMap((frame) => [
          frame.evaluate(pickWithGate, picking).catch(() => {}),
          frame.evaluate(followPickingIn, picking).catch(() => {}),
        ])
      );
    if (!on) {
      await inModeOrder(async () => {
        if (recorderMode?.mode() === PICKING_MODE)
          await recorderMode.setMode("recording");
      });
      return void (await gates(false));
    }
    if (!recorderMode)
      throw new Error(
        "Playwright's recorder is not reporting: it cannot pick."
      );
    // The documents leave the picking click alone before Playwright waits
    // for it.
    await gates(true);
    await inModeOrder(() => recorderMode!.setMode(PICKING_MODE));
  }

  async function startPlaywrightRecorder() {
    await startRecording!({
      actionAdded: (reported, action) => {
        const pageId = idOf.get(reported);
        if (!pageId) return;
        // What it names is read now, before anything else happens.
        const { report, fromSelector } = reportFrom(reported, action);
        inReportOrder(async () => ({
          kind: "interactionReported",
          page: pageId,
          report: await asUpload(
            await withPickedRef(
              await withAncestors(report, reported, fromSelector),
              reported
            ),
            reported
          ),
        }));
      },
      // Playwright revises the report of typing with each key typed into
      // the same field.
      actionUpdated: (reported, action) => {
        const pageId = idOf.get(reported);
        if (!pageId) return;
        const { report } = reportFrom(reported, action);
        inReportOrder(async () => ({
          kind: "interactionRevised",
          page: pageId,
          report,
        }));
      },
    });
    // A document that was open before the recorder started.
    await Promise.all(
      everyFrame().flatMap((frame) => [
        frame.evaluate(hidePlaywrightOverlay).catch(() => {}),
        frame.evaluate(keepCursorsAsTheyAre).catch(() => {}),
      ])
    );
  }

  /**
   * Puts the pages back as the recorder found them, for a browser that
   * stays open: nothing held back or watched any more, a click still held
   * passed on, and Playwright's recorder switched off in every document,
   * since its in-page part keeps the last mode it heard of once the
   * connection is gone. What does not answer in time is left as it is.
   */
  async function letGo(): Promise<void> {
    const frames = everyFrame();
    const putBack = Promise.all([
      ...frames.map((frame) =>
        frame.evaluate(stopGateAndWatch).catch(() => {})
      ),
      ...frames.map((frame) =>
        frame.evaluate(removeOwnElements, TOOLBAR_REMOVE).catch(() => {})
      ),
      ...frames.map((frame) =>
        frame.evaluate(followPickingIn, false).catch(() => {})
      ),
      ...[...held.values()].map(({ frame, input }) =>
        passOn(frame, input).catch(() => {})
      ),
      switchPlaywrightRecorderOff(frames),
    ]);
    held.clear();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      putBack,
      new Promise((resolve) => (timer = setTimeout(resolve, LET_GO_LIMIT_MS))),
    ]);
    clearTimeout(timer);
  }

  async function switchPlaywrightRecorderOff(frames: readonly Frame[]) {
    if (!recorderMode) return;
    await recorderMode.setMode("none").catch(() => {});
    await Promise.all(
      frames.map((frame) => frame.evaluate(noLongerRecording).catch(() => {}))
    );
  }

  return { carryOut, letGo };
}

/** How a browser begins the value of a file input with a file chosen. */
const FAKE_PATH = "C:\\fakepath\\";

/** How long reading the ancestors of a target may take before the element
 * is taken to be gone. */
const ANCESTOR_READ_MS = 1_000;

/** How long reading the names of an upload's files may take before the
 * input is taken to be gone: it is there when the files are chosen, and is
 * only waited for when the page has taken it away. */
const UPLOAD_READ_MS = 1_000;

/** The first file's name, when Playwright reports a file input's value as
 * typing, as 1.64 does for files chosen in one. */
function firstFileOf(report: InteractionReport): string | undefined {
  const text = report.values["text"];
  return report.type === "fill" &&
    typeof text === "string" &&
    text.startsWith(FAKE_PATH)
    ? text.slice(FAKE_PATH.length)
    : undefined;
}

/** Whether a report's picture lists a ref. */
const listedIn = (tree: string, ref: string | null): ref is string =>
  ref !== null && tree.includes(`[ref=${ref}]`);

/**
 * The target of a report, from the refs of the element the input acted on
 * and its ancestors, nearest first: the element itself when the picture
 * lists it, and otherwise the ancestors the picture lists. A ref the
 * picture does not list, as one an element kept from another read, says
 * nothing of it.
 */
function namedIn(
  tree: string,
  refs: readonly (string | null)[]
): NonNullable<InteractionReport["target"]> {
  const [acted = null, ...above] = refs;
  if (listedIn(tree, acted)) return { ref: pictureRef(acted), tree };
  return {
    ref: null,
    tree,
    ancestors: above.filter((ref) => listedIn(tree, ref)).map(pictureRef),
  };
}

/** The reports of an input of the mouse: the element under the pointer can
 * be inside the one it acted on. */
const MOUSE_REPORTS = new Set(["click", "check", "uncheck"]);

/** The events whose target a report of each kind names. */
const CHAIN_TYPES: Readonly<Record<string, readonly string[]>> = {
  click: ["click"],
  check: ["click", "keydown"],
  uncheck: ["click", "keydown"],
  press: ["keydown"],
  fill: ["input"],
  select: ["input"],
};

/**
 * A point of a frame's viewport, as a point of the page's: moved by the
 * place of each frame's content box in its parent, frames in frames
 * included.
 */
async function placeInPage(frame: Frame, at: { x: number; y: number }) {
  let point = { ...at };
  for (
    let inner: Frame | null = frame;
    inner?.parentFrame();
    inner = inner.parentFrame()
  ) {
    const element = await inner.frameElement();
    const offset = await element.evaluate(frameContentOffset);
    await element.dispose();
    point = { x: point.x + offset.x, y: point.y + offset.y };
  }
  return point;
}

/** A report of Playwright's recorder, in the engine's words. */
function reportOf(action: PlaywrightAction): InteractionReport {
  const { name, selector, ref, ariaSnapshot, signals, ...values } = action;
  void signals;
  return {
    type: name,
    selector: selector ?? null,
    target:
      ref && ariaSnapshot ? { ref: pictureRef(ref), tree: ariaSnapshot } : null,
    values,
  };
}

/** The page function the toolbar calls (the contract's `ToolbarBinding`). */
const TOOLBAR_BINDING: ToolbarBinding = "__aymeRecorderToolbar";
/** The event on the toolbar's host that takes it out of the page. */
const TOOLBAR_REMOVE = "ayme-recorder-toolbar:remove";

/** Playwright's recorder's mode in which it picks the element whose
 * visibility is asserted. */
const PICKING_MODE = "assertingVisibility";

/**
 * Every element of the page a lookup names: a step or a change row whose
 * element has look-alikes lights each of them up. A ref names one element,
 * and is taken only when it does. A selector and a ref reach into frames by
 * themselves; a role and name and a text are looked for in every frame's
 * document, and the matches of all are taken.
 */
async function matchesOf(page: Page, find: ElementLookup): Promise<Locator[]> {
  const frames =
    find.by === "selector" || find.by === "ref"
      ? [page.mainFrame()]
      : page.frames();
  const candidates = frames.map((frame) => locatorOf(frame, find));
  const counts = await Promise.all(
    candidates.map((candidate) => candidate.count().catch(() => 0))
  );
  // A ref names one element: it is trusted only when it does.
  if (find.by === "ref") return counts[0] === 1 ? [candidates[0]!] : [];
  return candidates.flatMap((candidate, at) =>
    Array.from({ length: counts[at]! }, (_, index) => candidate.nth(index))
  );
}

/** A frame's locator for an element a lookup asks for: a ref by the
 * adapter's own latest snapshot, a role and name by their exact words. */
function locatorOf(frame: Frame, find: ElementLookup): Locator {
  switch (find.by) {
    case "selector":
      return frame.locator(find.selector);
    case "ref":
      return frame.locator(`aria-ref=${find.ref}`);
    case "role":
      return frame.getByRole(
        find.role as Parameters<Frame["getByRole"]>[0],
        find.name ? { name: find.name, exact: true } : {}
      );
    case "text":
      return frame.getByText(find.text, { exact: true });
  }
}

/**
 * The ref an element has in the adapter's own snapshots, or its nearest
 * ancestor's that has one: the page's structure lists no element without
 * one. Undefined when none can be read.
 */
async function pickedRef(element: Locator): Promise<string | undefined> {
  for (let up = 0; up < PICKED_DEPTH; up += 1) {
    const own = await element
      .ariaSnapshot({ mode: "ai", timeout: ANCESTOR_READ_MS })
      .then(ownRefOf, () => null);
    if (own !== undefined) return own ?? undefined;
    element = element.locator("xpath=..");
  }
  return undefined;
}

/** How far up from a picked element its ref is looked for. */
const PICKED_DEPTH = 32;

/** How long finding the element of a highlight may take. */
const HIGHLIGHT_LOOKUP_MS = 500;

/** How long letting go of an attached browser may take. */
const LET_GO_LIMIT_MS = 5_000;

/** Sends a held input on to its page, as the press of the mouse or the
 * key it was. Returns false when the document it was held in is gone: it
 * is sent to no other. */
async function passOn(frame: Frame, input: HeldByPage): Promise<boolean> {
  const page = frame.page();
  const open = await frame
    .evaluate(openGate, {
      at:
        input.kind === "click"
          ? { x: input.x, y: input.y, detail: Math.max(1, input.detail) }
          : { code: input.code },
      document: input.document,
    })
    .catch(() => false);
  if (!open) return false;
  try {
    if (input.kind === "key") {
      const key = input.key === " " ? "Space" : input.key;
      const press = (name: string) =>
        page.keyboard.press([...input.modifiers, name].join("+"));
      // A key Playwright has no name for is sent by its place on the
      // keyboard.
      await press(key).catch(() => press(input.code));
      return true;
    }
    const clickCount = Math.max(1, input.detail);
    const at = await placeInPage(frame, input);
    for (const modifier of input.modifiers) await page.keyboard.down(modifier);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ clickCount });
    await page.mouse.up({ clickCount });
    for (const modifier of input.modifiers) await page.keyboard.up(modifier);
  } finally {
    // The gate closed by itself if the click arrived. The click may also
    // have taken the page elsewhere: that document's gate is gone with it.
    await frame.evaluate(closeGate).catch(() => {});
  }
  return true;
}
