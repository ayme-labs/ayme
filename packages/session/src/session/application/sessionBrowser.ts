import { Context, type Effect, type Scope } from "effect";

import type {
  Listing,
  RunAnswer,
  RunError,
  SessionStartError,
  TabReadError,
} from "../domain";
import type { BuiltPageObjects } from "./pageObjectsBuild";

/** The browser a Session asks for: one ayme opens, at `url` when given, or
 * a running one it joins at the address of its DevTools protocol. */
export type SessionBrowserRequest =
  | { readonly open: { readonly url?: string; readonly headed: boolean } }
  | { readonly join: { readonly cdp: string } };

/** A Tab the Session is the Host of. */
export interface HostedTab {
  /** Reads what a listing shows of the Tab now, from its page, once the
   * Run under way on the Tab has ended. */
  readonly listing: Effect.Effect<Listing, TabReadError>;
  /** Runs the Page Object Tool `tool` with `input` on the Tab, once the Run
   * under way there has ended, whichever Caller started it. ayme adds no
   * time limit. */
  readonly call: (
    tool: string,
    input: unknown
  ) => Effect.Effect<RunAnswer, RunError>;
}

/** A Tab of the Session's browser: the same object for as long as the Tab
 * is open. */
export interface BrowserTab {
  /** The URL its page shows now, which names the Tab on the command
   * line. */
  readonly url: () => string;
  /**
   * Makes the Session the Host of the Tab, with focus emulation on, so that
   * a Run works the same while the Tab is not in front (rule 6). `given`
   * hears each Page Object Id the Tab's Host gives out. It reads nothing of
   * the page, so an open dialog cannot hold it up.
   */
  readonly host: (
    given: (id: string) => void
  ) => Effect.Effect<HostedTab, TabReadError>;
}

/** The Tabs of a Session's browser, each to run the built Page Objects
 * on, with Page Object Ids from one source the Tabs share. */
export interface BrowserTabs {
  /** The Tabs open now, the most recently active first, in the order of the
   * browser's own tab list: it reads no page. */
  readonly open: Effect.Effect<readonly BrowserTab[], TabReadError>;
}

/** A browser a Session has. */
export interface HeldBrowser {
  /** The address of its DevTools protocol, which a browser automation
   * connects to: for a joined browser, the one it was joined at. */
  readonly address: string;
  /** Completes when the browser goes away. */
  readonly gone: Effect.Effect<void>;
  /**
   * Gets ready to be the Host of the browser's Tabs, running `pageObjects`
   * on each Tab the Session works on. It reads nothing of any page.
   */
  readonly host: (
    pageObjects: BuiltPageObjects
  ) => Effect.Effect<BrowserTabs, SessionStartError>;
}

/**
 * The browser of a Session: one of the Session's two seams, beside the
 * build of its Page Objects. Getting a browser
 * holds it until the scope closes, which closes a browser ayme opened and
 * only lets go of a joined one. Getting one stops at once when interrupted,
 * so that a stop during the start is answered at once (rule 1).
 */
export class SessionBrowser extends Context.Service<
  SessionBrowser,
  {
    readonly get: (
      request: SessionBrowserRequest
    ) => Effect.Effect<HeldBrowser, SessionStartError, Scope.Scope>;
  }
>()("@ayme-dev/session/session/SessionBrowser") {}
