// Test support (ADR-0057): a real Session on a scripted browser, where a
// test plays the browser by hand.
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  Stream,
} from "effect";
import { onTestFinished } from "vitest";

import {
  openSession,
  PageObjectsBuild,
  SessionBrowser,
  type BrowserTab,
  type BuiltPageObjects,
  type HostedTab,
  type SessionBrowserRequest,
  type TabIds,
} from "../src/session/application";
import {
  RunError,
  SessionStartError,
  TabReadError,
  type InspectorEvent,
  type Listing,
  type RunAnswer,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
} from "../src/session/domain";

/** The address the scripted browser gives when it opens; a joined one gives
 * the address it was joined at. */
const SCRIPTED_ADDRESS = "http://127.0.0.1:9222";

/** What the scripted build gives: the project's Page Objects, built. */
export const SCRIPTED_PAGE_OBJECTS: BuiltPageObjects = Object.freeze({
  built: "the scripted Page Objects",
});

/**
 * The remote control of a scripted browser and of the scripted build of
 * the project's Page Objects. Each finishes at once, unless the Session was
 * started with `held: true` for the browser's open, or `heldBuild: true`
 * for the build; then the test finishes it with `open` or `failOpen`, and
 * `finishBuild` or `failBuild`.
 */
export interface ScriptedBrowser extends ScriptedTab {
  /** Every browser the Session asked for, in order. */
  readonly asked: readonly SessionBrowserRequest[];
  /** Whether the Session has let its browser go, which closes a browser
   * ayme opened and only disconnects from a joined one. */
  readonly released: boolean;
  /** A held open finishes: the browser is there. */
  open(): void;
  /** A held open fails, for the reason a person reads. */
  failOpen(reason: string): void;
  /** A held open breaks with an error nobody expected, such as a folder
   * that could not be made. */
  breakOpen(defect: Error): void;
  /** A held build finishes: the Page Objects are built. */
  finishBuild(): void;
  /** A held build fails, with the build's errors as `ayme open` prints
   * them. */
  failBuild(errors: string): void;
  /** The built Page Objects the Session got ready to run on its Tabs,
   * each time it did. */
  readonly hostedWith: readonly BuiltPageObjects[];
  /** The browser goes away: it crashed, or someone closed it. */
  goAway(): void;
  /** Opens a Tab, at `url` when given, which becomes the most recently
   * active one, as a Tab the browser automation opens does. */
  openTab(url?: string): ScriptedTab;
  /** Every read of the browser's tab list fails, for the reason a person
   * reads. */
  failTabList(reason: string): void;
  /** The next read of the browser's tab list takes the Tabs open now and
   * answers only once the test calls the function it returns, as an HTTP
   * read that is slow to answer. */
  holdTabList(): () => void;
}

/** The remote control of one Tab of the scripted browser. The scripted
 * browser's own members control the Tab it opened on. */
export interface ScriptedTab {
  /** Whether the Session is the Tab's Host, which turns focus emulation on
   * for it. */
  readonly hosted: boolean;
  /** What the Tab shows from now on: a page without Page Objects until
   * then. Its URL names the Tab. */
  show(listing: Listing): void;
  /** Every read of the Tab's page fails, for the reason a person reads,
   * until the test shows a listing again. */
  failReads(reason: string): void;
  /** Every read of the Tab's page waits, as behind a presence predicate
   * that never resolves, until the test shows a listing again. */
  holdReads(): void;
  /** Every Run started on the Tab, in order. */
  readonly runs: readonly { readonly tool: string; readonly input: unknown }[];
  /** How each Run on the Tab ends from now on: as `answer` resolves, or
   * fails as it rejects with a RunError. Until then a Run answers that the
   * page settled. */
  answerRuns(
    answer: (tool: string, input: unknown) => Promise<RunAnswer>
  ): void;
  /** The Tab's Host gives out the Page Object Id `id` to a Page Object of
   * the class `className`, as it does when a read first finds one. */
  give(id: string, className: string): void;
  /** The Tab's Host forgets `id`, as when a read finds its element gone
   * from the page. */
  release(id: string): void;
  /** The browser automation brings the Tab to the front. */
  activate(): void;
  /** The Tab closes, and Playwright says so. */
  close(): void;
  /** Every call on the Tab's Inspector contract, in order, as the Tab's
   * Host received it. */
  readonly inspectorCalls: readonly {
    readonly method: string;
    readonly params: unknown;
  }[];
  /** How the Tab's Inspector contract answers each call from now on: as
   * `answer` resolves, or fails as it rejects. Until then it answers with
   * the method's name. */
  answerInspector(
    answer: (method: string, params: unknown) => Promise<unknown>
  ): void;
  /** How many listen to the events of the Tab's Inspector contract now. */
  readonly inspectorListeners: number;
  /** The Tab's Inspector contract tells its listeners `event`. */
  tellInspector(event: unknown): void;
}

/** What the scripted Tab shows until a test says otherwise. */
export const EMPTY_LISTING: Listing = {
  tab: { url: "about:blank", title: "" },
  pageObjectTree: "No Page Object is on the page.",
  tools: [],
};

/** The Session's interface with each member as a promise. */
export interface ScriptedSession {
  readonly started: Promise<SessionAnswer>;
  ask(request: SessionRequest): Promise<SessionAnswer>;
  readonly ended: Promise<SessionEnd>;
  /** Listens to the Session's events from now on, as an Inspector window
   * does. */
  listen(): Listening;
}

/** An Inspector window listening to a Session's events. */
export interface Listening {
  /** What it heard so far, in order. */
  readonly heard: readonly InspectorEvent[];
  /** Resolves once the events ended. */
  readonly done: Promise<void>;
  /** Stops listening, as a window that closes. */
  stop(): Promise<void>;
}

/** How the scripted browser and build behave: each finishes at once
 * unless held. */
export type ScriptedOptions = {
  /** The open waits for the test: `open` or `failOpen`. */
  readonly held?: true;
  /** The build waits for the test: `finishBuild` or `failBuild`. */
  readonly heldBuild?: true;
};

export type ScriptedSessionOptions = SessionBrowserRequest &
  ScriptedOptions & {
    /** The Session's name: "default" when not given. */
    readonly name?: string;
    /** Where its process serves the Session's Inspector window; none when
     * not given. */
    readonly inspector?: string;
  };

/** A Tab of the scripted browser, as the Session reaches it and as a test
 * controls it. */
type Tab = BrowserTab & { readonly control: ScriptedTab };

/** A scripted Tab at `url`, among the browser's `open` Tabs. */
function scriptedTab(url: string, open: Tab[]): Tab {
  let shown: Listing | TabReadError | "held" = {
    ...EMPTY_LISTING,
    tab: { url, title: "" },
  };
  let shownUrl = url;
  const runs: { tool: string; input: unknown }[] = [];
  let answerRun: (tool: string, input: unknown) => Promise<RunAnswer> = () =>
    Promise.resolve({ settled: true });
  let given: TabIds | undefined;
  const closed = Deferred.makeUnsafe<void>();
  const inspectorCalls: { method: string; params: unknown }[] = [];
  let answerInspector: (method: string, params: unknown) => Promise<unknown> = (
    method
  ) => Promise.resolve(method);
  const listeners = new Set<(event: unknown) => void>();
  const hosted: HostedTab = {
    listing: Effect.suspend(() =>
      shown === "held"
        ? Effect.never
        : shown instanceof TabReadError
          ? Effect.fail(shown)
          : Effect.succeed(shown)
    ),
    call: (tool: string, input: unknown) =>
      Effect.tryPromise({
        try: () => {
          runs.push({ tool, input });
          return answerRun(tool, input);
        },
        catch: (error) =>
          error instanceof RunError ? error : new RunError(String(error)),
      }),
    inspector: {
      request: (method, params) =>
        Effect.tryPromise({
          try: () => {
            inspectorCalls.push({ method, params });
            return answerInspector(method, params);
          },
          catch: (error) =>
            new TabReadError(
              error instanceof Error ? error.message : String(error)
            ),
        }),
      events: Stream.callback<unknown>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (event: unknown) =>
              void Queue.offerUnsafe(queue, event);
            listeners.add(listener);
            return listener;
          }),
          (listener) => Effect.sync(() => listeners.delete(listener))
        )
      ),
    },
  };
  const tab: Tab = {
    url: () => shownUrl,
    closed: Deferred.await(closed),
    // As a page's registry refuses a second owner.
    host: (giving) =>
      given
        ? Effect.fail(
            new TabReadError(
              "ayme could not run the project's Page Objects on the tab: The ayme runtime already has an active owner."
            )
          )
        : Effect.sync(() => {
            given = giving;
            return hosted;
          }),
    control: {
      get hosted() {
        return given !== undefined;
      },
      show: (listing) => {
        shown = listing;
        shownUrl = listing.tab.url;
      },
      failReads: (reason) => (shown = new TabReadError(reason)),
      holdReads: () => (shown = "held"),
      runs,
      answerRuns: (answer) => (answerRun = answer),
      give: (id, className) => {
        if (!given) throw new Error("The Session is not this Tab's Host.");
        given.given(id, className);
      },
      release: (id) => given?.released(id),
      activate: () => {
        open.splice(open.indexOf(tab), 1);
        open.unshift(tab);
      },
      close: () => {
        if (open.includes(tab)) open.splice(open.indexOf(tab), 1);
        Deferred.doneUnsafe(closed, Exit.void);
      },
      inspectorCalls,
      answerInspector: (answer) => (answerInspector = answer),
      get inspectorListeners() {
        return listeners.size;
      },
      tellInspector: (event) => {
        for (const listener of listeners) listener(event);
      },
    },
  };
  return tab;
}

/** A scripted browser and build, as the layer a Session gets them from,
 * and their remote control. */
export function scriptedBrowser({ held, heldBuild }: ScriptedOptions = {}): {
  layer: Layer.Layer<SessionBrowser | PageObjectsBuild>;
  browser: ScriptedBrowser;
} {
  const asked: SessionBrowserRequest[] = [];
  const hostedWith: BuiltPageObjects[] = [];
  let released = false;
  // The open Tabs, the most recently active first.
  const open: Tab[] = [];
  let tabList: TabReadError | undefined;
  let heldTabList: Deferred.Deferred<void> | undefined;
  const opened = Deferred.makeUnsafe<void, SessionStartError>();
  const built = Deferred.makeUnsafe<BuiltPageObjects, SessionStartError>();
  const gone = Deferred.makeUnsafe<void>();
  if (!held) Deferred.doneUnsafe(opened, Exit.void);
  if (!heldBuild)
    Deferred.doneUnsafe(built, Exit.succeed(SCRIPTED_PAGE_OBJECTS));

  const openTab = (url = "about:blank") => {
    const tab = scriptedTab(url, open);
    open.unshift(tab);
    return tab;
  };
  const first = openTab();
  const tabs = {
    open: Effect.suspend(() => {
      if (tabList) return Effect.fail(tabList);
      const now = [...open];
      const held = heldTabList;
      heldTabList = undefined;
      return held
        ? Deferred.await(held).pipe(Effect.as(now))
        : Effect.succeed(now);
    }),
  };
  const build = Layer.succeed(PageObjectsBuild, {
    build: Deferred.await(built),
  });
  const browsers = Layer.succeed(SessionBrowser, {
    get: (asking) =>
      // The wait for the open is outside the acquire, which cannot be
      // interrupted, so that a Session can stop a start under way.
      Effect.acquireRelease(
        Effect.sync(() => asked.push(asking)),
        () => Effect.sync(() => (released = true))
      ).pipe(
        Effect.andThen(Deferred.await(opened)),
        Effect.as({
          address: "join" in asking ? asking.join.cdp : SCRIPTED_ADDRESS,
          gone: Deferred.await(gone),
          host: (pageObjects: BuiltPageObjects) =>
            Effect.sync(() => {
              hostedWith.push(pageObjects);
              return tabs;
            }),
        })
      ),
  });

  return {
    layer: Layer.merge(browsers, build),
    browser: {
      asked,
      hostedWith,
      get released() {
        return released;
      },
      open: () => Deferred.doneUnsafe(opened, Exit.void),
      failOpen: (reason) =>
        Deferred.doneUnsafe(opened, Exit.fail(new SessionStartError(reason))),
      breakOpen: (defect) => Deferred.doneUnsafe(opened, Exit.die(defect)),
      finishBuild: () =>
        Deferred.doneUnsafe(built, Exit.succeed(SCRIPTED_PAGE_OBJECTS)),
      failBuild: (errors) =>
        Deferred.doneUnsafe(built, Exit.fail(new SessionStartError(errors))),
      goAway: () => Deferred.doneUnsafe(gone, Exit.void),
      openTab: (url) => openTab(url).control,
      failTabList: (reason) => (tabList = new TabReadError(reason)),
      holdTabList: () => {
        const held = (heldTabList = Deferred.makeUnsafe<void>());
        return () => Deferred.doneUnsafe(held, Exit.void);
      },
      ...first.control,
      get hosted() {
        return first.control.hosted;
      },
      get inspectorListeners() {
        return first.control.inspectorListeners;
      },
    },
  };
}

/** Starts a Session on a scripted browser. It ends when the test does. */
export async function startScriptedSession(
  options: ScriptedSessionOptions
): Promise<{ session: ScriptedSession; browser: ScriptedBrowser }> {
  const { held, heldBuild, name = "default", inspector, ...request } = options;
  const { layer, browser } = scriptedBrowser({
    ...(held ? { held } : {}),
    ...(heldBuild ? { heldBuild } : {}),
  });
  const scope = Effect.runSync(Scope.make());
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const session = await Effect.runPromise(
    openSession(
      request,
      name,
      inspector === undefined ? {} : { inspector }
    ).pipe(Effect.provide(layer), Scope.provide(scope))
  );
  const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

  return {
    session: {
      started: run(session.started),
      ask: (asking) => run(session.ask(asking)),
      ended: run(session.ended),
      listen: () => {
        const heard: InspectorEvent[] = [];
        const listening = Effect.runFork(
          Stream.runForEach(session.events, (event) =>
            Effect.sync(() => heard.push(event))
          )
        );
        onTestFinished(() => Effect.runPromise(Fiber.interrupt(listening)));
        return {
          heard,
          done: Effect.runPromise(Fiber.await(listening)).then(() => {}),
          stop: () => Effect.runPromise(Fiber.interrupt(listening)),
        };
      },
    },
    browser,
  };
}
