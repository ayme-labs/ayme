import { Effect, Layer, Queue } from "effect";
import type { Browser } from "playwright-core";

import {
  RecordedBrowser,
  RecorderStartError,
  type BrowserSignal,
} from "../../session";
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
      yield* Effect.tryPromise({
        try: () => openPage(browser, options.url, signals),
        catch: unavailable,
      });
      return RecordedBrowser.of({ signals });
    })
  );

async function openPage(
  browser: Browser,
  url: string,
  signals: Queue.Enqueue<BrowserSignal>
) {
  browser.on("disconnected", () =>
    Queue.offerUnsafe(signals, { kind: "browserGone" })
  );
  // No fixed viewport: the page has the size of its window.
  const context = await browser.newContext({ viewport: null });
  context.on("page", (page) =>
    page.on("close", () =>
      Queue.offerUnsafe(signals, {
        kind: "pageClosed",
        pagesLeft: context.pages().length,
      })
    )
  );
  const page = await context.newPage();
  // A page that does not load is no reason to stop: the browser shows the
  // error, and the person can go elsewhere or close it.
  await page.goto(url).catch(() => {});
}
