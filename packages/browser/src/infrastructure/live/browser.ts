import { Effect, type Scope } from "effect";
import type { Browser as PlaywrightBrowser } from "playwright-core";

import type { BrowserError } from "../../browserError";
import { browserUnavailable, type BrowserRequest } from "../../browserRequest";
import type { Playwright, ProjectPlaywright } from "../../projectPlaywright";

/** A browser ayme has, through the project's Playwright. */
export interface Browser {
  readonly playwrightBrowser: PlaywrightBrowser;
  /** True when ayme started it, so that ayme may close it. */
  readonly opened: boolean;
}

/** Releases a browser: a started one is closed, and one the person already
 * closed has nothing left to close. A joined one is only let go: Playwright
 * closes its connection, not the browser. */
const release = (playwrightBrowser: PlaywrightBrowser) =>
  playwrightBrowser.close().catch(() => {});

/**
 * Starts or joins a browser with the project's Playwright. Closing the
 * scope releases it: a browser ayme started is closed, and one it joined is
 * only let go, so it stays open. Interrupted while Playwright still gets
 * the browser, it stops at once, as Playwright's own wait has no means to
 * be stopped and can last until its timeout; a browser Playwright gets
 * after that is released without any other use.
 */
export const browser = (
  { playwright }: ProjectPlaywright,
  request: BrowserRequest
): Effect.Effect<Browser, BrowserError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.suspend(() => {
      const getting =
        "join" in request
          ? playwright.chromium.connectOverCDP(request.join.cdp, {
              // The browser is someone else's: its settings stay as they
              // are.
              noDefaults: true,
            })
          : launch(playwright, request.open);
      return Effect.tryPromise({
        try: () => getting,
        catch: (cause) => browserUnavailable(request, cause),
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => void getting.then(release, () => {}))
        )
      );
    }),
    (playwrightBrowser) => Effect.promise(() => release(playwrightBrowser)),
    { interruptible: true }
  ).pipe(
    Effect.map((playwrightBrowser) => ({
      playwrightBrowser,
      opened: "open" in request,
    }))
  );

function launch(
  playwright: Playwright,
  open: Extract<BrowserRequest, { open: unknown }>["open"]
): Promise<PlaywrightBrowser> {
  const options = {
    headless: !open.headed,
    args:
      open.debugPort === undefined
        ? []
        : [`--remote-debugging-port=${open.debugPort}`],
    // Terminal signals belong to the caller, which ends ayme. Left on,
    // Playwright would exit the process on the first one.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
  if (open.profile === undefined) return playwright.chromium.launch(options);
  return (
    playwright.chromium
      // The browser is shared with the developer's browser automation, so
      // ayme emulates no viewport of its own on its pages.
      .launchPersistentContext(open.profile, { ...options, viewport: null })
      // A context on a profile belongs to a browser of its own, which
      // Playwright always gives on Chromium.
      .then((context) => context.browser()!)
  );
}
