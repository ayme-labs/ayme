import { Context, type Effect, type Scope } from "effect";

import type { Listing, SessionStartError, TabReadError } from "../domain";
import type { BuiltPageObjects } from "./pageObjectsBuild";

/** The browser a Session asks for: one ayme opens, at `url` when given. */
export type SessionBrowserRequest = {
  readonly open: { readonly url?: string; readonly headed: boolean };
};

/** A Tab the Session is the Host of. */
export interface HostedTab {
  /** Reads what a listing shows of the Tab now, from its page. */
  readonly listing: Effect.Effect<Listing, TabReadError>;
}

/** A browser a Session has. */
export interface HeldBrowser {
  /** The address of its DevTools protocol, which a browser automation
   * connects to. */
  readonly address: string;
  /** Completes when the browser goes away. */
  readonly gone: Effect.Effect<void>;
  /**
   * Makes the Session the Host of the Tab the browser opened on, running
   * `pageObjects` there. It reads nothing of the page, so an open dialog
   * cannot hold it up.
   */
  readonly host: (
    pageObjects: BuiltPageObjects
  ) => Effect.Effect<HostedTab, SessionStartError>;
}

/**
 * The browser of a Session: one of the Session's two seams, beside the
 * build of its Page Objects. Getting a browser
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
