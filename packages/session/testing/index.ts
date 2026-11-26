// Test support (ADR-0057): a real Session on a scripted browser, where a
// test plays the browser by hand.
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { onTestFinished } from "vitest";

import {
  openSession,
  PageObjectsBuild,
  SessionBrowser,
  type BuiltPageObjects,
  type SessionBrowserRequest,
} from "../src/session/application";
import {
  RunError,
  SessionStartError,
  TabReadError,
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
export interface ScriptedBrowser {
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
  /** The built Page Objects the Session ran on its Tab, each time it
   * became the Tab's Host. */
  readonly hostedWith: readonly BuiltPageObjects[];
  /** The browser goes away: it crashed, or someone closed it. */
  goAway(): void;
  /** What the Tab the browser opened on shows from now on: a page without
   * Page Objects until then. */
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
}

/** How the scripted browser and build behave: each finishes at once
 * unless held. */
export type ScriptedOptions = {
  /** The open waits for the test: `open` or `failOpen`. */
  readonly held?: true;
  /** The build waits for the test: `finishBuild` or `failBuild`. */
  readonly heldBuild?: true;
};

export type ScriptedSessionOptions = SessionBrowserRequest & ScriptedOptions;

/** A scripted browser and build, as the layer a Session gets them from,
 * and their remote control. */
export function scriptedBrowser({ held, heldBuild }: ScriptedOptions = {}): {
  layer: Layer.Layer<SessionBrowser | PageObjectsBuild>;
  browser: ScriptedBrowser;
} {
  const asked: SessionBrowserRequest[] = [];
  const hostedWith: BuiltPageObjects[] = [];
  let released = false;
  let shown: Listing | TabReadError | "held" = EMPTY_LISTING;
  const runs: { tool: string; input: unknown }[] = [];
  let answerRun: (tool: string, input: unknown) => Promise<RunAnswer> = () =>
    Promise.resolve({ settled: true });
  const opened = Deferred.makeUnsafe<void, SessionStartError>();
  const built = Deferred.makeUnsafe<BuiltPageObjects, SessionStartError>();
  const gone = Deferred.makeUnsafe<void>();
  if (!held) Deferred.doneUnsafe(opened, Exit.void);
  if (!heldBuild)
    Deferred.doneUnsafe(built, Exit.succeed(SCRIPTED_PAGE_OBJECTS));

  const tab = {
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
              return tab;
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
      show: (listing) => (shown = listing),
      failReads: (reason) => (shown = new TabReadError(reason)),
      holdReads: () => (shown = "held"),
      runs,
      answerRuns: (answer) => (answerRun = answer),
    },
  };
}

/** Starts a Session on a scripted browser. It ends when the test does. */
export async function startScriptedSession(
  options: ScriptedSessionOptions
): Promise<{ session: ScriptedSession; browser: ScriptedBrowser }> {
  const { held, heldBuild, ...request } = options;
  const { layer, browser } = scriptedBrowser({
    ...(held ? { held } : {}),
    ...(heldBuild ? { heldBuild } : {}),
  });
  const scope = Effect.runSync(Scope.make());
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const session = await Effect.runPromise(
    openSession(request).pipe(Effect.provide(layer), Scope.provide(scope))
  );
  const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

  return {
    session: {
      started: run(session.started),
      ask: (asking) => run(session.ask(asking)),
      ended: run(session.ended),
    },
    browser,
  };
}
