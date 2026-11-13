import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
} from "@ayme-dev/core/structural-observation";
import { Effect, Layer, Queue } from "effect";
import type { Browser, Frame, Page } from "playwright-core";

import { RecordedBrowser } from "../../session/application";
import {
  RecorderStartError,
  type BrowserRequest,
  type BrowserSignal,
} from "../../session/domain";
import {
  hidePlaywrightOverlay,
  installGate,
  waitUntilQuiet,
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
      const scope = yield* Effect.scope;
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
        ask: (request) =>
          request.kind === "waitForSettled"
            ? // The page's own time: it goes on beside the queue.
              Effect.asVoid(
                Effect.forkIn(
                  Effect.promise(() => recorded.carryOut(request)),
                  scope
                )
              )
            : Effect.promise(() => recorded.carryOut(request)),
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
 * `tell` says what came of it. A request it cannot carry out, as on a page
 * that is gone, is answered by nothing.
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
  // Every document gets the gate, switched off, before its own scripts run.
  await context.addInitScript(installGate, heldBinding);
  await context.addInitScript(hidePlaywrightOverlay);

  const page = await context.newPage();
  // A page that does not load is no reason to stop: the browser shows the
  // error, and the person can go elsewhere or close it.
  await page.goto(url).catch(() => {});

  const everyFrame = () => [...pages.values()].flatMap((open) => open.frames());

  async function carryOut(request: BrowserRequest): Promise<void> {
    switch (request.kind) {
      case "reportInteractions":
        return reportInteractions();
      case "holdInputs":
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
        await passOn(input.frame, input.click);
        return tell({ kind: "inputPassedOn", input: request.input, at: now() });
      }
      case "waitForSettled": {
        const open = pages.get(request.page);
        if (open) await settled(open);
        return tell({
          kind: "pageSettled",
          page: request.page,
          input: request.input,
        });
      }
    }
  }

  async function reportInteractions() {
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

/** Sends a held click on to its page, as the press of the mouse it was. */
async function passOn(frame: Frame, click: HeldClick) {
  const page = frame.page();
  const clickCount = Math.max(1, click.detail);
  await frame.evaluate((at) => window.__aymeRecorderGate?.open(at), {
    x: click.x,
    y: click.y,
  });
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
}

/**
 * Waits until the page is a Settled Page: loaded, and every frame quiet for
 * core's quiet window, or core's deadline passed.
 */
async function settled(page: Page) {
  const quiet = {
    quietMs: SETTLED_PAGE_QUIET_MS,
    deadlineMs: SETTLED_PAGE_DEADLINE_MS,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page
      .waitForLoadState("load", { timeout: SETTLED_PAGE_DEADLINE_MS })
      .catch(() => {});
    try {
      await Promise.all(
        page.frames().map((frame) =>
          frame.evaluate(waitUntilQuiet, quiet).catch((error: unknown) => {
            // A frame that went away while it was watched no longer changes.
            if (!frame.isDetached()) throw error;
          })
        )
      );
      return;
    } catch {
      // The main frame went elsewhere under the wait: wait for the new
      // document, or give up when the page is gone.
      if (page.isClosed()) return;
    }
  }
}
