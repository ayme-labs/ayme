import { BrowserError } from "./browserError";

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
