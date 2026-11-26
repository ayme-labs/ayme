import { BrowserError } from "./browserError";

/** Leaves every dialog of the browser to whoever else drives it: without a
 * listener, Playwright dismisses a dialog at once. */
type DialogsLeftOpen = { readonly leaveDialogsOpen?: boolean | undefined };

/** The browser ayme gets: one it starts, or a running one it joins at the
 * address of its DevTools protocol. */
export type BrowserRequest =
  | {
      readonly open: DialogsLeftOpen & {
        readonly headed: boolean;
        /** Opens the browser's DevTools protocol on this port. */
        readonly debugPort?: number | undefined;
        /** Starts Chromium on a profile in this folder, so that every
         * page, those a client that joins opens among them, is in one
         * context and one window. */
        readonly profile?: string | undefined;
      };
    }
  | { readonly join: DialogsLeftOpen & { readonly cdp: string } };

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
        `Playwright could not connect to the browser at ${request.join.cdp}. ${reason}`,
        // Playwright's own TimeoutError, which this package does not load.
        { timedOut: cause instanceof Error && cause.name === "TimeoutError" }
      )
    : new BrowserError(
        "browser did not start",
        `Playwright could not open Chromium. ${reason}`
      );
}
