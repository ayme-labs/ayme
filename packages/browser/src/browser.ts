import { Effect, type Scope } from "effect";
import type { Browser as PlaywrightBrowser } from "playwright-core";

import { BrowserError } from "./browserError";
import type { ProjectPlaywright } from "./projectPlaywright";

/** The browser ayme gets: one it starts, or a running one it joins at the
 * address of its DevTools protocol. */
export type BrowserRequest =
  | {
      readonly open: {
        readonly headed: boolean;
        /** Opens the browser's DevTools protocol on this port. */
        readonly debugPort?: number | undefined;
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
          : playwright.chromium.launch({
              headless: !request.open.headed,
              args:
                request.open.debugPort === undefined
                  ? []
                  : [`--remote-debugging-port=${request.open.debugPort}`],
              // Terminal signals belong to the caller, which ends ayme.
              // Left on, Playwright would exit the process on the first one.
              handleSIGINT: false,
              handleSIGTERM: false,
              handleSIGHUP: false,
            }),
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
