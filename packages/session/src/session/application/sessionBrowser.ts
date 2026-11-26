import { Context, type Effect, type Scope } from "effect";

import type { SessionStartError } from "../domain";

/** The browser a Session asks for: one ayme opens, at `url` when given. */
export type SessionBrowserRequest = {
  readonly open: { readonly url?: string; readonly headed: boolean };
};

/** A browser a Session has. */
export interface HeldBrowser {
  /** The address of its DevTools protocol, which a browser automation
   * connects to. */
  readonly address: string;
  /** Completes when the browser goes away. */
  readonly gone: Effect.Effect<void>;
}

/**
 * The browser of a Session: the Session's one seam. Getting a browser
 * holds it until the scope closes, which closes a browser ayme opened.
 */
export class SessionBrowser extends Context.Service<
  SessionBrowser,
  {
    readonly get: (
      request: SessionBrowserRequest
    ) => Effect.Effect<HeldBrowser, SessionStartError, Scope.Scope>;
  }
>()("@ayme-dev/session/session/SessionBrowser") {}
