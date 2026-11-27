import {
  Cause,
  Context,
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
  type Dialog,
  dialogOpen,
  dialogOpenAtRun,
  dialogOpenInListing,
  endAnswer,
  endedAtStart,
  endedBeforeAnswer,
  failed,
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
  type TabDialog,
  TabDialogOpen,
  unknownRequest,
} from "../domain";
import { answerInspector, inspectorEvents, withoutWindow } from "./inspector";
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
        Effect.catch((error) =>
          Effect.succeed(
            failed(
              error instanceof TabDialogOpen
                ? dialogOpenInListing(error.url, error.dialog)
                : error.message
            )
          )
        )
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
          chosen: started.tabs.chosen(undefined),
        });
      return Effect.succeed(unknownRequest);
    };

    // A command still waiting when the Session ends is answered at once,
    // before its browser closes: a Run or a listing need never end (rule 1).
    const untilEnd = (answer: Effect.Effect<SessionAnswer>) =>
      Effect.raceFirst(
        answer,
        Deferred.await(ending).pipe(Effect.map(endedBeforeAnswer))
      );

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
      events: inspectorEvents(
        Deferred.await(start).pipe(
          Effect.flatMap(({ tabs }) => tabs.chosen(undefined))
        ),
        Deferred.await(ending),
        name
      ),
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
      // Hosting a Tab waits on its page, which a dialog holds: a Tab whose
      // dialog counts as open is answered with it, and hosted later.
      const now = yield* Stream.runHead(
        tab.dialog.pipe(Stream.filter((now) => now !== "opening"))
      );
      if (Option.isSome(now) && isOpen(now.value))
        return yield* Effect.fail(new TabDialogOpen(tab.url(), now.value.open));
      // Cached at once, so two requests that arrive together host the Tab
      // once; a failed hosting is tried again by the next request.
      const hosting = yield* Effect.cached(
        Effect.raceFirst(
          tab.host({
            given: (id, className) => {
              owners.set(id, tab);
              rooted.add(className);
            },
            released: (id) => owners.delete(id),
          }),
          dialogCounts(tab)
        ).pipe(
          Effect.map((hosted) =>
            atDialogs(
              untilClosed(inTurns(hosted, ending), tab.closed),
              tab,
              scope
            )
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
  return {
    chosen: (url, call) => {
      const id =
        call && rooted.has(classOf(call.tool)) ? idIn(call.input) : undefined;
      const owner = id === undefined ? undefined : owners.get(id);
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
    dialog: hosted.dialog,
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
  const inTurn = <A, E>(work: Effect.Effect<A, E>) =>
    Semaphore.withPermit(
      turn,
      Effect.gen(function* () {
        if (yield* ending) return yield* Effect.never;
        if ((yield* Answered).answered) return yield* Effect.interrupt;
        return yield* work;
      })
    );
  return {
    listing: inTurn(hosted.listing),
    call: (tool, input) => inTurn(hosted.call(tool, input)),
    // A Run from the Inspector window takes the turn; its reads do not.
    inspector: {
      ...hosted.inspector,
      request: (method, params) =>
        method === "runTool"
          ? inTurn(hosted.inspector.request(method, params))
          : hosted.inspector.request(method, params),
    },
    dialog: hosted.dialog,
  };
}

/** Whether the Session already answered the request whose work this is:
 * work still waiting for the Tab's turn then never starts, since its Caller
 * may have run the command again meanwhile. */
const Answered = Context.Reference<{ answered: boolean }>(
  "@ayme-dev/session/session/Answered",
  { defaultValue: () => ({ answered: false }) }
);

const isOpen = (now: TabDialog): now is { readonly open: Dialog } =>
  typeof now === "object";

/** Fails with `tab`'s dialog once one counts as open there. */
const dialogCounts = (tab: BrowserTab) =>
  tab.dialog.pipe(
    Stream.filter(isOpen),
    Stream.runHead,
    Effect.flatMap((open) =>
      Option.isSome(open)
        ? Effect.fail(new TabDialogOpen(tab.url(), open.value.open))
        : Effect.never
    )
  );

/**
 * `hosted`, whose listings, Runs and Inspector calls are answered that a
 * dialog is open while one counts as open on its Tab (rules 4 and 5): at
 * once when one is, and the moment one counts while they wait for the Tab's
 * turn or run. One that arrives while a dialog opens waits until it counts
 * or closes. What a command was answered for goes on in `scope` and keeps
 * the Tab's turn until it ends, so the next Run starts only once a stopped
 * action has ended; nothing reads its outcome. One still waiting for the
 * turn never starts. The answers name the Tab by
 * `tab`'s URL, since its title is the page's, which the dialog holds.
 */
function atDialogs(
  hosted: HostedTab,
  tab: BrowserTab,
  scope: Scope.Scope
): HostedTab {
  const counted = hosted.dialog.pipe(Stream.filter((now) => now !== "opening"));
  const atDialog = <A, E>(
    work: Effect.Effect<A, E>,
    refused: (dialog: Dialog) => E
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const now = yield* Stream.runHead(counted);
      if (Option.isSome(now) && isOpen(now.value))
        return yield* Effect.fail(refused(now.value.open));
      const request = { answered: false };
      const working = yield* Effect.forkIn(
        Effect.provideService(work, Answered, request),
        scope
      );
      const opened = counted.pipe(
        Stream.filter(isOpen),
        Stream.runHead,
        Effect.flatMap((open) =>
          Option.isSome(open)
            ? Effect.sync(() => (request.answered = true)).pipe(
                Effect.andThen(Effect.fail(refused(open.value.open)))
              )
            : Effect.never
        )
      );
      // Work the Session's end interrupted is answered by that end.
      const answer = Fiber.join(working).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.never
            : Effect.failCause(cause)
        )
      );
      return yield* Effect.raceFirst(answer, opened);
    });
  const atRun = (dialog: Dialog) => new RunError(dialogOpenAtRun(dialog));
  return {
    listing: atDialog(
      hosted.listing,
      (dialog) => new TabReadError(dialogOpenInListing(tab.url(), dialog))
    ),
    call: (tool, input) => atDialog(hosted.call(tool, input), atRun),
    inspector: {
      ...hosted.inspector,
      request: (method, params) =>
        atDialog(
          hosted.inspector.request(method, params),
          (dialog) =>
            new TabReadError(
              method === "runTool" ? atRun(dialog).message : dialogOpen(dialog)
            )
        ),
    },
    dialog: hosted.dialog,
  };
}

/** Why a start failed, also when it broke in a way nobody expected. */
export const whyNotStarted = (
  cause: Cause.Cause<SessionStartError>
): SessionStartError =>
  Option.getOrElse(Cause.findErrorOption(cause), () =>
    brokenStart(Cause.squash(cause))
  );
