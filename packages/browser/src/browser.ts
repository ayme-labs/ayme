import { Effect, type Scope } from "effect";
import type { Browser as PlaywrightBrowser } from "playwright-core";

import { BrowserError } from "./browserError";
import type { Playwright, ProjectPlaywright } from "./projectPlaywright";

/** The browser ayme gets: one it starts, or a running one it joins at the
 * address of its DevTools protocol. */
export type BrowserRequest =
  | {
      readonly open: {
        readonly headed: boolean;
        /** Opens the browser's DevTools protocol on this port. */
        readonly debugPort?: number | undefined;
        /** Starts Chromium on a profile in this folder, so that every
         * page, those a client that joins opens among them, is in one
         * context and one window. */
        readonly profile?: string | undefined;
      };
    }
  | { readonly join: { readonly cdp: string } };

/** A browser ayme has, through the project's Playwright. */
export interface Browser {
  readonly playwrightBrowser: PlaywrightBrowser;
  /** True when ayme started it, so that ayme may close it. */
  readonly opened: boolean;
}

/**
 * Starts or joins a browser with the project's Playwright. Closing the
 * scope releases it: a browser ayme started is closed, and one it joined is
 * only let go, so it stays open.
 */
export const browser = (
  { playwright }: ProjectPlaywright,
  request: BrowserRequest
): Effect.Effect<Browser, BrowserError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        "join" in request
          ? playwright.chromium.connectOverCDP(request.join.cdp, {
              // The browser is someone else's: its settings stay as they
              // are.
              noDefaults: true,
            })
          : launch(playwright, request.open),
      catch: (cause) => browserUnavailable(request, cause),
    }),
    // A started browser the person already closed has nothing left to
    // close. A joined one is only let go: Playwright closes its connection,
    // not the browser.
    (playwrightBrowser) =>
      Effect.promise(() => playwrightBrowser.close().catch(() => {}))
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

/** Why the browser a request asks for cannot be had, with its cause: also
 * for a caller whose own first steps in the browser fail. */
export function browserUnavailable(
  request: BrowserRequest,
  cause: unknown
): BrowserError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return "join" in request
    ? new BrowserError(
        "address unreachable",
        `Playwright could not connect to the browser at ${request.join.cdp}. ${reason}`
      )
    : new BrowserError(
        "browser did not start",
        `Playwright could not open Chromium. ${reason}`
      );
}
