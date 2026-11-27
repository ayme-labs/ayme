import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Scope,
  Semaphore,
  Stream,
} from "effect";

import {
  brokenStart,
  callAnswer,
  detachRefused,
  endAnswer,
  endedAtStart,
  endedBeforeAnswer,
  failed,
  idNotOnShownTab,
  idOnAnotherTab,
  type InspectorEvent,
  joinedAnswer,
  type Listing,
  NO_TAB_OPEN,
  noTabShows,
  openedAnswer,
  pageObjectsAnswer,
  RunError,
  runFailed,
  TAB_CLOSED,
  TabReadError,
  toolsAnswer,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
  SessionStartError,
  unknownRequest,
} from "../domain";
import {
  answerInspector,
  followTabs,
  withoutWindow,
  type ShowableTab,
} from "./inspector";
import { PageObjectsBuild } from "./pageObjectsBuild";
import {
  SessionBrowser,
  type HeldBrowser,
  type BrowserTab,
  type BrowserTabs,
  type HostedTab,
  type SessionBrowserRequest,
} from "./sessionBrowser";

/** What a Session has once it started: its browser, and its Tabs. */
type Started = { readonly held: HeldBrowser; readonly tabs: SessionTabs };

/** One running ayme connected to one browser. */
export interface Session {
  /** The answer to the command that started the Session, once its start
   * succeeded or failed. */
  readonly started: Effect.Effect<SessionAnswer>;
  /** Answers one request, after the start: a request that arrives while
   * the Session starts waits for it. Always answers. */
  readonly ask: (request: SessionRequest) => Effect.Effect<SessionAnswer>;
  /** What it tells its Inspector windows, for one window from when it
   * starts listening. */
  readonly events: Stream.Stream<InspectorEvent>;
  readonly ended: Effect.Effect<SessionEnd>;
}

/**
 * Starts the Session named `name` on the browser `request` asks for,
 * running the project's Page Objects there once they are built. It returns
 * at once, while the Session starts, and the Session ends at the latest
 * when the scope closes. Its answers name it in the commands they tell the
 * user to run. `inspector` is where its process serves its Inspector
 * window, when it serves one, and `agentApp` the socket of that window an
 * Agent App's view connects to.
 */
export const openSession = (
  request: SessionBrowserRequest,
  name: string,
  {
    inspector,
    agentApp,
  }: { readonly inspector?: string; readonly agentApp?: string } = {}
): Effect.Effect<
  Session,
  never,
  SessionBrowser | PageObjectsBuild | Scope.Scope
> =>
  Effect.gen(function* () {
    const browsers = yield* SessionBrowser;
    const scope = yield* Scope.Scope;
    const browserScope = yield* Scope.fork(scope);
    const pageObjects = yield* PageObjectsBuild;
    // Only a browser ayme opened is closed when the Session ends.
    const opened = "open" in request;
    const start = yield* Deferred.make<Started, SessionStartError>();
    const ending = yield* Deferred.make<SessionEnd>();
    const ended = yield* Deferred.make<SessionEnd>();

    // The build reads no page, so it runs while the browser opens; the
    // first to fail ends the start, and the browser closes with its scope.
    const starting = yield* Effect.all(
      [browsers.get(request), pageObjects.build],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.flatMap(([held, built]) =>
        held.host(built, { window: inspector }).pipe(
          Effect.map((tabs): Started => ({
            held,
            tabs: sessionTabs(
              withoutWindow(tabs, inspector),
              name,
              browserScope,
              Deferred.isDone(ending)
            ),
          }))
        )
      ),
      Scope.provide(browserScope),
      Effect.forkIn(scope)
    );

    // The first end stops a start still under way and closes the browser;
    // any later one waits for it.
    const end = (how: SessionEnd) =>
      Effect.gen(function* () {
        if (yield* Deferred.succeed(ending, how)) {
          yield* Fiber.interrupt(starting);
          yield* Deferred.fail(start, new SessionStartError(endedAtStart(how)));
          yield* Scope.close(browserScope, Exit.void);
          yield* Deferred.succeed(ended, how);
        }
        return yield* Deferred.await(ended);
      });

    // Every way out of the start settles its answer and the Session's end:
    // an interrupted start is one that end stopped.
    yield* Fiber.await(starting).pipe(
      Effect.flatMap(
        Exit.match({
          // The watch for the browser going away gets one turn before the
          // start is answered, so a browser already gone ends the Session
          // first.
          onSuccess: (started) =>
            started.held.gone.pipe(
              Effect.andThen(end("browser gone")),
              Effect.forkIn(scope),
              Effect.andThen(Effect.yieldNow),
              Effect.andThen(Deferred.succeed(start, started))
            ),
          onFailure: (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Deferred.fail(start, whyNotStarted(cause)).pipe(
                  Effect.andThen(end("start failed"))
                ),
        })
      ),
      Effect.forkIn(scope)
    );

    const shownTabs = followTabs(
      Deferred.await(start).pipe(Effect.flatMap(({ tabs }) => tabs.active)),
      Deferred.await(ending),
      name,
      scope
    );

    const afterStart = (
      answer: (started: Started) => Effect.Effect<SessionAnswer>
    ) =>
      Deferred.await(start).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(failed(error.message)),
          onSuccess: answer,
        })
      );

    /** A listing of the Tab `on` names, answered by `answer`. */
    const listed = (
      { tabs }: Started,
      { tab }: { readonly tab?: string },
      answer: (listing: Listing) => SessionAnswer
    ) =>
      tabs.chosen(tab).pipe(
        Effect.flatMap((hosted) => hosted.listing),
        Effect.map(answer),
        Effect.catch((error) => Effect.succeed(failed(error.message)))
      );

    const answerTo = (
      request: Exclude<
        SessionRequest,
        { readonly stop: unknown } | { readonly detach: unknown }
      >,
      started: Started
    ): Effect.Effect<SessionAnswer> => {
      if ("pageObjects" in request)
        return listed(started, request.pageObjects, (listing) =>
          pageObjectsAnswer(listing, name, request.pageObjects.tab)
        );
      if ("tools" in request)
        return listed(started, request.tools, toolsAnswer);
      if ("call" in request) {
        const { tool, input, tab } = request.call;
        return started.tabs.chosen(tab, { tool, input }).pipe(
          Effect.catch((error) => Effect.fail(new RunError(error.message))),
          Effect.flatMap((hosted) => hosted.call(tool, input)),
          Effect.map(callAnswer),
          Effect.catch((error) => Effect.succeed(runFailed(error)))
        );
      }
      if ("inspector" in request)
        return answerInspector(request.inspector, {
          window: inspector,
          agentApp,
          name,
          shown: shownTabs.shown,
          chosen: started.tabs.chosen(undefined),
          idElsewhere: started.tabs.idElsewhere,
        });
      return Effect.succeed(unknownRequest);
    };

    // A command still waiting when the Session ends is answered at once,
    // before its browser closes: a Run or a listing need never end (rule 1).
    // One that arrives once the Session is ending starts no work.
    const untilEnd = (answer: Effect.Effect<SessionAnswer>) => {
      const ended = Deferred.await(ending).pipe(Effect.map(endedBeforeAnswer));
      return Effect.flatMap(Deferred.isDone(ending), (ends) =>
        ends ? ended : Effect.raceFirst(answer, ended)
      );
    };

    return {
      // A browser that went away before the start was answered is no
      // Session (rule 2).
      started: afterStart(({ held }) =>
        Effect.gen(function* () {
          if (!(yield* Deferred.isDone(ending)))
            return (opened ? openedAnswer : joinedAnswer)(held.address, name);
          return failed(endedAtStart(yield* Deferred.await(ended)));
        })
      ),
      // A stop, or a detach from a joined browser, ends a start under way
      // at once; any other request waits for the start. Detaching from a
      // browser ayme opened would leave it without an owner (rule 11).
      ask: (request) => {
        if ("detach" in request && opened)
          return Effect.succeed(detachRefused(name));
        if ("stop" in request || "detach" in request)
          return end("stop" in request ? "stopped" : "detached").pipe(
            Effect.flatMap((how) =>
              how === "start failed"
                ? afterStart(() => Effect.succeed(endAnswer(how, opened)))
                : Effect.succeed(endAnswer(how, opened))
            )
          );
        return afterStart((started) => untilEnd(answerTo(request, started)));
      },
      events: shownTabs.events,
      ended: Deferred.await(ended),
    };
  });

/** The `id` a tool's input gives, when it gives a string. */
const idIn = (input: unknown): string | undefined => {
  const id = (input as { readonly id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : undefined;
};

/** The class whose Page Object Tool `tool` is: the compiler names each
 * `<class>.<action>`. */
const classOf = (tool: string) => tool.slice(0, tool.indexOf("."));

/** A Session's Tabs, as its requests reach them. */
type SessionTabs = {
  /**
   * The Tab a request works on, with the Session as its Host: for a `call`
   * of a tool that takes a Page Object Id, the Tab whose Host gave the id;
   * else the most recently active Tab whose URL is `url`, else the most
   * recently active Tab.
   */
  readonly chosen: (
    url: string | undefined,
    call?: { readonly tool: string; readonly input: unknown }
  ) => Effect.Effect<HostedTab, TabReadError>;
  /** The most recently active Tab, with the Session as its Host; none when
   * no tab is open. */
  readonly active: Effect.Effect<ShowableTab | undefined, TabReadError>;
  /** Why a `call` on the Tab `on` cannot run: the Page Object Id it takes
   * is of another Tab. */
  readonly idElsewhere: (
    on: BrowserTab,
    call: { readonly tool: string; readonly input: unknown }
  ) => string | undefined;
};

/** The Tabs of `browser`, each hosted once, the first time the Session
 * named `name` works on it, and the Page Object Ids each Tab's Host gave.
 * A Tab is let go when its page closes, in `scope`. None starts work once
 * `ending`. */
function sessionTabs(
  browser: BrowserTabs,
  name: string,
  scope: Scope.Scope,
  ending: Effect.Effect<boolean>
): SessionTabs {
  const hosts = new Map<BrowserTab, Effect.Effect<HostedTab, TabReadError>>();
  // The Tab each id was given on, while its Host knows the id.
  const owners = new Map<string, BrowserTab>();
  // The classes some id was given to: those with a Page Object Root, whose
  // tools take a Page Object Id.
  const rooted = new Set<string>();
  const retire = (tab: BrowserTab) =>
    Effect.sync(() => {
      hosts.delete(tab);
      for (const [id, owner] of owners) if (owner === tab) owners.delete(id);
    });
  const hostOf = (tab: BrowserTab) =>
    Effect.gen(function* () {
      const known = hosts.get(tab);
      if (known) return yield* known;
      // Hosting starts JavaScript that an interrupt cannot stop.
      if (yield* ending) return yield* Effect.never;
      // Cached at once, so two requests that arrive together host the Tab
      // once; a failed hosting is tried again by the next request.
      const hosting = yield* Effect.cached(
        tab
          .host({
            given: (id, className) => {
              owners.set(id, tab);
              rooted.add(className);
            },
            released: (id) => owners.delete(id),
          })
          .pipe(
            Effect.map((hosted) =>
              untilClosed(inTurns(hosted, ending), tab.closed)
            ),
            Effect.tap(() =>
              tab.closed.pipe(Effect.andThen(retire(tab)), Effect.forkIn(scope))
            )
          )
      );
      hosts.set(tab, hosting);
      return yield* hosting.pipe(
        Effect.tapError(() => Effect.sync(() => hosts.delete(tab)))
      );
    });
  /** The Tab whose Host gave the Page Object Id that `call` takes. */
  const ownerOf = (call?: {
    readonly tool: string;
    readonly input: unknown;
  }) => {
    const id =
      call && rooted.has(classOf(call.tool)) ? idIn(call.input) : undefined;
    return id === undefined ? undefined : { id, tab: owners.get(id) };
  };
  return {
    active: browser.open.pipe(
      Effect.flatMap(([tab]) =>
        tab
          ? hostOf(tab).pipe(Effect.map((hosted) => ({ tab, hosted })))
          : Effect.succeed(undefined)
      )
    ),
    idElsewhere: (on, call) => {
      const owned = ownerOf(call);
      return owned?.tab && owned.tab !== on
        ? idNotOnShownTab(owned.id, owned.tab.url())
        : undefined;
    },
    chosen: (url, call) => {
      const owned = ownerOf(call);
      const id = owned?.id;
      const owner = owned?.tab;
      if (owner) {
        if (url === undefined || owner.url() === url) return hostOf(owner);
        return Effect.fail(
          new TabReadError(idOnAnotherTab(id!, owner.url(), url))
        );
      }
      return browser.open.pipe(
        Effect.flatMap((open) => {
          const tab =
            url === undefined
              ? open[0]
              : open.find((each) => each.url() === url);
          if (tab) return hostOf(tab);
          return Effect.fail(
            new TabReadError(
              open.length === 0
                ? NO_TAB_OPEN
                : noTabShows(
                    url!,
                    open.map((each) => each.url()),
                    name
                  )
            )
          );
        })
      );
    },
  };
}

/** `hosted`, whose listings, Runs and Inspector calls are answered once
 * its Tab is `closed`, and whose Inspector events end then: an action
 * inside a wait of its own may go on until that wait ends. */
function untilClosed(
  hosted: HostedTab,
  closed: Effect.Effect<void>
): HostedTab {
  const orClosed = <A, E>(work: Effect.Effect<A, E>, error: E) =>
    Effect.raceFirst(work, closed.pipe(Effect.andThen(Effect.fail(error))));
  return {
    listing: orClosed(hosted.listing, new TabReadError(TAB_CLOSED)),
    call: (tool, input) =>
      orClosed(hosted.call(tool, input), new RunError(TAB_CLOSED)),
    inspector: {
      request: (method, params) =>
        orClosed(
          hosted.inspector.request(method, params),
          new TabReadError(TAB_CLOSED)
        ),
      events: hosted.inspector.events.pipe(Stream.interruptWhen(closed)),
    },
  };
}

/**
 * `hosted`, whose listings and Runs also wait for the Tab's turn in the
 * Session, where the Session's end stops one still waiting: the Host's own
 * wait cannot be stopped, and a joined browser stays open. One whose turn
 * comes once the Session is `ending` never starts; the end answers it.
 */
function inTurns(hosted: HostedTab, ending: Effect.Effect<boolean>): HostedTab {
  const turn = Semaphore.makeUnsafe(1);
  const unlessEnding = <A, E>(work: Effect.Effect<A, E>) =>
    ending.pipe(Effect.flatMap((ends) => (ends ? Effect.never : work)));
  const inTurn = <A, E>(work: Effect.Effect<A, E>) =>
    Semaphore.withPermit(turn, unlessEnding(work));
  return {
    listing: inTurn(hosted.listing),
    call: (tool, input) => inTurn(hosted.call(tool, input)),
    // A Run from the Inspector window takes the turn; its reads do not,
    // and start no JavaScript, which an interrupt cannot stop, once ending.
    inspector: {
      ...hosted.inspector,
      request: (method, params) =>
        method === "runTool"
          ? inTurn(hosted.inspector.request(method, params))
          : unlessEnding(hosted.inspector.request(method, params)),
    },
  };
}

/** Why a start failed, also when it broke in a way nobody expected. */
export const whyNotStarted = (
  cause: Cause.Cause<SessionStartError>
): SessionStartError =>
  Option.getOrElse(Cause.findErrorOption(cause), () =>
    brokenStart(Cause.squash(cause))
  );
