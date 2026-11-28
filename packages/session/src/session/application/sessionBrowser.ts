import { Context, type Effect, type Scope, type Stream } from "effect";

import type {
  Listing,
  RunAnswer,
  RunError,
  SessionStartError,
  TabDialog,
  TabDocument,
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
  /** The Inspector's contract with the runtime on the Tab's page, as its
   * Host serves it to a window outside the page. */
  readonly inspector: TabInspector;
  /** The Tab's dialog as the Session counts it now, and again after each
   * change (rule 4). It reads nothing of the page, which a dialog holds. */
  readonly dialog: Stream.Stream<TabDialog>;
  /** Reads which document the Tab's main frame shows now, as the browser
   * tells it without the page's JavaScript, so a read of the page that
   * failed can tell whether a new document started meanwhile. ayme adds no
   * time limit. */
  readonly document: Effect.Effect<TabDocument, TabReadError>;
  /** Reads the Page Objects on the Tab's page now, as a Run reads them
   * before its action, so their tools are what the page shows. */
  readonly observe: Effect.Effect<void, TabReadError>;
  /** Whether the Page Object Tool `tool`, in the Page Objects the Tab's
   * Host runs now, takes a Page Object Id: its class declares a root. It
   * reads nothing of the page. */
  readonly takesId: (tool: string) => boolean;
  /** Runs `pageObjects` on the Tab from now on, in place of those it ran,
   * at once: the Swap, which the Session makes only between Runs (rule 7).
   * It waits for nothing on the page: registering the classes starts reads
   * of it that may fail, and waits for none, so an open dialog cannot hold
   * it up. */
  readonly swap: (
    pageObjects: BuiltPageObjects
  ) => Effect.Effect<void, TabReadError>;
}

/** A Tab's Inspector contract, in the plain data a window sends and
 * reads. */
export interface TabInspector {
  /** Calls the contract's `method` with `params`, at once: a Run it starts
   * waits for the Run under way in the Host's own turn. Answers what the
   * contract answered, or fails with why. */
  readonly request: (
    method: string,
    params: unknown
  ) => Effect.Effect<unknown, TabReadError>;
  /** The contract's events while the stream runs. Ending the last one ends
   * what the windows asked for on the page, such as a highlight. */
  readonly events: Stream.Stream<unknown>;
}

/** What a Tab's Host tells of the Page Object Ids it gives out. */
export interface TabIds {
  /** It gave `id` to a Page Object of the class `className`. */
  readonly given: (id: string, className: string) => void;
  /** It forgot `id`, as its element left the page: the id names nothing
   * from now on. */
  readonly released: (id: string) => void;
}

/** A Tab of the Session's browser: the same object for as long as the Tab
 * is open. Its Host can be started once, as a page's registry has one
 * owner. */
export interface BrowserTab {
  /** The URL its page shows now, which names the Tab on the command
   * line. */
  readonly url: () => string;
  /** Completes when Playwright says the Tab's page closed. */
  readonly closed: Effect.Effect<void>;
  /** The Tab's dialog as the Session counts it, watched from when
   * Playwright handed its page over: known before the Tab is hosted. */
  readonly dialog: Stream.Stream<TabDialog>;
  /**
   * Makes the Session the Host of the Tab, running `pageObjects`, with focus
   * emulation on, so that a Run works the same while the Tab is not in
   * front (rule 6). `ids` hears of each Page Object Id the Tab's Host gives
   * out and forgets. It reads no document, but its setup over DevTools
   * waits on the page, so it fails once the page has not answered within a
   * stated limit.
   */
  readonly host: (
    ids: TabIds,
    pageObjects: BuiltPageObjects
  ) => Effect.Effect<HostedTab, TabReadError>;
}

/** The Tabs of a Session's browser, each to run the built Page Objects
 * on, with Page Object Ids from one source the Tabs share. */
export interface BrowserTabs {
  /** The Tabs open now, the most recently active first, in the order of the
   * browser's own tab list: it reads no page. A read made before a Tab
   * opened lacks it, so a read only chooses a Tab; `closed` says one is
   * gone. */
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
   * Gets ready to be the Host of the browser's Tabs, on the runtime the
   * built `pageObjects` run on. It reads nothing of any page. A tab
   * that shows the Inspector window served at `window` is none of its Tabs,
   * and no read of them waits for it.
   */
  readonly host: (
    pageObjects: BuiltPageObjects,
    options: { readonly window: string | undefined }
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
