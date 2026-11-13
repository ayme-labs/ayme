import {
  MonotonicTimeMsSchema,
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type PageActivitySource,
} from "@ayme-dev/core/structural-observation";
import { Effect, Layer, Queue } from "effect";
import type { Browser, BrowserContext, Frame, Page } from "playwright-core";

import { RecordedBrowser } from "../../session/application";
import {
  RecorderStartError,
  type BrowserRequest,
  type BrowserSignal,
} from "../../session/domain";
import {
  hidePlaywrightOverlay,
  installActivityWatch,
  installGate,
  startGate,
  type HeldClick,
} from "./pageScripts";
import { loadProjectPlaywright } from "./projectPlaywright";

/**
 * The recorded browser on stock Playwright: Chromium, launched by the
 * project's own Playwright on a URL. Closing the layer's scope closes the
 * browser.
 */
export const stockBrowser = (options: {
  readonly projectDir: string;
  readonly url: string;
  readonly headless: boolean;
  readonly debugPort: number | undefined;
}): Layer.Layer<RecordedBrowser, RecorderStartError> =>
  Layer.effect(
    RecordedBrowser,
    Effect.gen(function* () {
      const playwright = yield* loadProjectPlaywright(options.projectDir);
      const signals = yield* Queue.unbounded<BrowserSignal>();
      const unavailable = (cause: unknown) =>
        new RecorderStartError(
          "browser-unavailable",
          `Playwright could not open Chromium. ${cause instanceof Error ? cause.message : String(cause)}`
        );
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
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
            }),
          catch: unavailable,
        }),
        // A browser the person already closed has nothing left to close.
        (browser) => Effect.promise(() => browser.close().catch(() => {}))
      );
      const recorded = yield* Effect.tryPromise({
        try: () =>
          openPage(browser, options.url, (signal) =>
            Queue.offerUnsafe(signals, signal)
          ),
        catch: unavailable,
      });
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

/** Milliseconds on the clock Playwright's own times are on. */
const now = () => Math.floor(performance.now() * 1e3) / 1e3;

/** Playwright's own recorder, started on a context: a private part of
 * Playwright, as it is in 1.64. */
type PlaywrightRecorder = {
  _startRecording(
    options: { language: string },
    sink: {
      actionAdded(page: Page, action: PlaywrightAction): void;
      actionUpdated(page: Page, action: PlaywrightAction): void;
      signalAdded(page: Page, signal: unknown): void;
    }
  ): Promise<void>;
};
/**
 * Playwright's recorder as it runs beside the context, with the mode it is
 * in: a private part of Playwright. "recording" reports Interactions, and
 * "none" reports nothing and leaves the page's input alone.
 */
type PlaywrightRecorderMode = {
  mode(): string;
  setMode(mode: "none" | "recording"): Promise<void>;
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

/** What Playwright's recorder says of one action. */
type PlaywrightAction = {
  readonly name: string;
  readonly selector?: string;
  /** The target in `ariaSnapshot`, the recorder's own picture of the page. */
  readonly ref?: string | null;
  readonly ariaSnapshot?: string;
  readonly signals?: unknown;
} & Readonly<Record<string, unknown>>;

/**
 * Opens the context and its page, and returns what carries out the engine's
 * requests on them. It decides nothing: each request is one thing done, and
 * `tell` says what came of it. Requests are carried out as they come, side
 * by side: the lifecycle asks for the next of two that must follow each
 * other only when the first is answered.
 */
async function openPage(
  browser: Browser,
  url: string,
  tell: (signal: BrowserSignal) => void
) {
  browser.on("disconnected", () => tell({ kind: "browserGone" }));
  // No fixed viewport: the page has the size of its window.
  const context = await browser.newContext({ viewport: null });

  const pages = new Map<string, Page>();
  const idOf = new Map<Page, string>();
  /** The inputs the pages hold back, until they are passed on. */
  const held = new Map<string, { frame: Frame; click: HeldClick }>();
  let inputs = 0;
  /** How often the gate was switched. */
  let gateChanges = 0;

  context.on("page", (page) => {
    const id = `page_${idOf.size + 1}`;
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
  });

  const heldBinding = "__aymeRecorderHeld";
  await context.exposeBinding(
    heldBinding,
    ({ page, frame }, click: HeldClick) => {
      const pageId = idOf.get(page);
      if (!pageId) return;
      const input = `input_${++inputs}`;
      held.set(input, { frame, click });
      tell({ kind: "inputHeld", input, page: pageId });
    }
  );
  /** Who hears of a page's activity now: a wait for a Settled Page. */
  const listening = new Map<Page, Set<() => void>>();
  const changedBinding = "__aymeRecorderChanged";
  await context.exposeBinding(changedBinding, ({ page }) => {
    for (const heard of listening.get(page) ?? []) heard();
  });
  // Every document gets the gate and the activity watch, both switched off,
  // before its own scripts run.
  await context.addInitScript(installGate, heldBinding);
  await context.addInitScript(installActivityWatch, changedBinding);
  await context.addInitScript(hidePlaywrightOverlay);

  /**
   * A page's activity, for core's wait (ADR-0024): every change to the
   * elements of any of its frames, and every document one of its frames
   * goes to or finishes loading. It says only that something happened.
   */
  const activityOf = (page: Page): PageActivitySource => ({
    subscribe(onActivity) {
      const watch = (frame: Frame, on: boolean) =>
        // A frame that is gone has nothing to tell.
        void frame
          .evaluate((on) => window.__aymeRecorderActivity?.watch(on), on)
          .catch(() => {});
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

  const page = await context.newPage();
  // A page that does not load is no reason to stop: the browser shows the
  // error, and the person can go elsewhere or close it.
  await page.goto(url).catch(() => {});

  const everyFrame = () => [...pages.values()].flatMap((open) => open.frames());

  async function carryOut(request: BrowserRequest): Promise<void> {
    switch (request.kind) {
      case "reportInteractions":
        return reportInteractions(request.on);
      case "holdInputs":
        // A document that starts from now on starts so.
        await context.addInitScript(startGate, {
          on: request.on,
          change: ++gateChanges,
        });
        // A frame that is gone holds nothing back.
        await Promise.all(
          everyFrame().map((frame) =>
            frame
              .evaluate((on) => window.__aymeRecorderGate?.set(on), request.on)
              .catch(() => {})
          )
        );
        return tell({ kind: "inputsHeld", on: request.on });
      case "takeSnapshot": {
        const open = pages.get(request.page);
        if (!open) return;
        const at = now();
        const tree = await open.ariaSnapshot({ mode: "ai" });
        return tell({
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
      case "passOn": {
        const input = held.get(request.input);
        held.delete(request.input);
        if (!input) return;
        if (!(await passOn(input.frame, input.click)))
          return tell({ kind: "inputGone", input: request.input });
        return tell({ kind: "inputPassedOn", input: request.input, at: now() });
      }
      case "waitForSettled": {
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
        return tell({
          kind: "pageSettled",
          page: request.page,
          input: request.input,
        });
      }
    }
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
    if (recorderMode) await recorderMode.setMode(on ? "recording" : "none");
    else if (on) {
      await startPlaywrightRecorder();
      recorderMode = await recorderModeOf(context);
    }
    tell({ kind: "reportingInteractions", on });
  }

  async function startPlaywrightRecorder() {
    await (context as unknown as PlaywrightRecorder)._startRecording(
      { language: "playwright-test" },
      {
        actionAdded: (reported, action) => {
          const pageId = idOf.get(reported);
          if (!pageId) return;
          const { name, selector, ref, ariaSnapshot, signals, ...values } =
            action;
          void signals;
          tell({
            kind: "interactionReported",
            page: pageId,
            report: {
              type: name,
              selector: selector ?? null,
              target: ref && ariaSnapshot ? { ref, tree: ariaSnapshot } : null,
              values,
            },
          });
        },
        // A report that Playwright revises, as for a double click, and the
        // signals it adds to one are not read yet.
        actionUpdated: () => {},
        signalAdded: () => {},
      }
    );
    // A document that was open before the recorder started.
    await Promise.all(
      everyFrame().map((frame) =>
        frame.evaluate(hidePlaywrightOverlay).catch(() => {})
      )
    );
  }

  return { carryOut };
}

/** Sends a held click on to its page, as the press of the mouse it was.
 * Returns false when the document it was held in is gone: it is sent to no
 * other. */
async function passOn(frame: Frame, click: HeldClick): Promise<boolean> {
  const page = frame.page();
  const clickCount = Math.max(1, click.detail);
  const open = await frame
    .evaluate(
      ({ at, document }) =>
        window.__aymeRecorderGate?.open(at, document) ?? false,
      { at: { x: click.x, y: click.y }, document: click.document }
    )
    .catch(() => false);
  if (!open) return false;
  try {
    for (const modifier of click.modifiers) await page.keyboard.down(modifier);
    await page.mouse.move(click.x, click.y);
    await page.mouse.down({ clickCount });
    await page.mouse.up({ clickCount });
    for (const modifier of click.modifiers) await page.keyboard.up(modifier);
  } finally {
    // The gate closed by itself if the click arrived. The click may also
    // have taken the page elsewhere: that document's gate is gone with it.
    await frame
      .evaluate(() => window.__aymeRecorderGate?.close())
      .catch(() => {});
  }
  return true;
}
