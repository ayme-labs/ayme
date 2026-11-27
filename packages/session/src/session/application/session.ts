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
  type TabDialog,
  TabDialogOpen,
  unknownRequest,
  withBuildLine,
} from "../domain";
import {
  answerInspector,
  followTabs,
  withoutWindow,
  type ShowableTab,
} from "./inspector";
import { PageObjectsBuild } from "./pageObjectsBuild";
import {
  rebuilding,
  type InTurn,
  type Rebuilds,
  type SwappingTab,
} from "./rebuilds";
import {
  SessionBrowser,
  type HeldBrowser,
  type BrowserTab,
  type BrowserTabs,
  type SessionBrowserRequest,
} from "./sessionBrowser";

/** What a Session has once it started: its browser, its Tabs, and its
 * Page Objects as its builds leave them. */
type Started = {
  readonly held: HeldBrowser;
  readonly tabs: SessionTabs;
  readonly rebuilds: Rebuilds;
};

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
 * window, when it serves one, `opening` gives that address with a one-use
 * code for each `ayme inspect`, and `agentApp` is the socket of that window
 * an Agent App's view connects to.
 */
export const openSession = (
  request: SessionBrowserRequest,
  name: string,
  {
    inspector,
    opening,
    agentApp,
  }: {
    readonly inspector?: string;
    readonly opening?: () => string;
    readonly agentApp?: string;
  } = {}
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
        Effect.all([
          held.host(built, { window: inspector }),
          rebuilding(built, pageObjects, browserScope),
        ]).pipe(
          Effect.map(([tabs, rebuilds]): Started => ({
            held,
            rebuilds,
            tabs: sessionTabs(
              withoutWindow(tabs, inspector),
              name,
              browserScope,
              Deferred.isDone(ending),
              rebuilds
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

    /** A listing of the Tab `on` names, answered by `answer`, with the
     * build line of that Tab, or of the Session for a Tab not hosted. */
    const listed = (
      { tabs, rebuilds }: Started,
      { tab }: { readonly tab?: string },
      answer: (listing: Listing) => SessionAnswer
    ) => {
      const refused = (error: Error) =>
        Effect.succeed(
          failed(
            error instanceof TabDialogOpen
              ? dialogOpenInListing(error.url, error.dialog)
              : error.message
          )
        );
      return tabs.chosen(tab).pipe(
        Effect.flatMap((hosted) =>
          hosted.listing.pipe(
            Effect.map(answer),
            Effect.catch(refused),
            Effect.map((answer) => withBuildLine(answer, hosted.buildLine()))
          )
        ),
        Effect.catch((error) =>
          refused(error).pipe(
            Effect.map((answer) => withBuildLine(answer, rebuilds.buildLine()))
          )
        )
      );
    };

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
          opening,
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
  ) => Effect.Effect<SwappingTab, TabReadError>;
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
 * `ending`. Each swaps in the Page Objects `rebuilds` leaves between its
 * Runs. */
function sessionTabs(
  browser: BrowserTabs,
  name: string,
  scope: Scope.Scope,
  ending: Effect.Effect<boolean>,
  rebuilds: Rebuilds
): SessionTabs {
  const hosts = new Map<BrowserTab, Effect.Effect<SwappingTab, TabReadError>>();
  // The Tab each id was given on, while its Host knows the id.
  const owners = new Map<string, BrowserTab>();
  // Each Tab whose hosting finished, for a choice that reads no page.
  const hostedNow = new Map<BrowserTab, SwappingTab>();
  const retire = (tab: BrowserTab) =>
    Effect.sync(() => {
      hosts.delete(tab);
      hostedNow.delete(tab);
      for (const [id, owner] of owners) if (owner === tab) owners.delete(id);
    });
  const hostOf = (tab: BrowserTab) =>
    Effect.gen(function* () {
      const known = hosts.get(tab);
      if (known) return yield* known;
      // Hosting starts JavaScript that an interrupt cannot stop.
      if (yield* ending) return yield* Effect.never;
      // Hosting a Tab waits on its page, which a dialog holds: a Tab whose
      // dialog counts as open is answered with it, and hosted later.
      const now = yield* Effect.raceFirst(
        Stream.runHead(
          tab.dialog.pipe(Stream.filter((now) => now !== "opening"))
        ),
        tab.closed.pipe(
          Effect.andThen(Effect.fail(new TabReadError(TAB_CLOSED)))
        )
      );
      if (Option.isSome(now) && isOpen(now.value))
        return yield* Effect.fail(new TabDialogOpen(tab.url(), now.value.open));
      // Cached at once, so two requests that arrive together host the Tab
      // once; a failed hosting is tried again by the next request.
      const startedWith = rebuilds.newest();
      const hosting = yield* Effect.cached(
        Effect.raceFirst(
          tab.host(
            {
              given: (id) => owners.set(id, tab),
              released: (id) => owners.delete(id),
            },
            startedWith
          ),
          dialogCounts(tab)
        ).pipe(
          Effect.flatMap((hosted) => {
            const turn = turns(ending);
            return rebuilds
              .swapping(hosted, startedWith, {
                inTurn: turn.inTurn,
                closed: tab.closed,
              })
              .pipe(
                Effect.map((swapping) =>
                  atDialogs(
                    untilClosed(inTurns(swapping, turn, scope), tab.closed),
                    tab,
                    scope
                  )
                )
              );
          }),
          Effect.tap((hosted) => Effect.sync(() => hostedNow.set(tab, hosted))),
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
  /** The most recently active Tab whose URL is `url`, else the most
   * recently active Tab. */
  const byUrl = (url: string | undefined) =>
    browser.open.pipe(
      Effect.flatMap((open) => {
        const tab =
          url === undefined ? open[0] : open.find((each) => each.url() === url);
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
  return {
    active: browser.open.pipe(
      Effect.flatMap(([tab]) =>
        tab
          ? hostOf(tab).pipe(Effect.map((hosted) => ({ tab, hosted })))
          : Effect.succeed(undefined)
      )
    ),
    // Only an id the tool takes, in the build the Tab `on` runs, is one.
    idElsewhere: (on, call) => {
      if (!hostedNow.get(on)?.takesId(call.tool)) return undefined;
      const id = idIn(call.input);
      const owner = id === undefined ? undefined : owners.get(id);
      return owner && owner !== on
        ? idNotOnShownTab(id!, owner.url())
        : undefined;
    },
    chosen: (url, call) => {
      const id = call && idIn(call.input);
      const owner = id === undefined ? undefined : owners.get(id);
      if (!call || !owner) return byUrl(url);
      // Only an id the tool takes, in the build its Tab runs, chooses it.
      return hostOf(owner).pipe(
        Effect.flatMap((hosted) => {
          if (!hosted.takesId(call.tool)) return byUrl(url);
          if (url === undefined || owner.url() === url)
            return Effect.succeed(hosted);
          return Effect.fail(
            new TabReadError(idOnAnotherTab(id!, owner.url(), url))
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
  hosted: SwappingTab,
  closed: Effect.Effect<void>
): SwappingTab {
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
    takesId: hosted.takesId,
    buildLine: hosted.buildLine,
  };
}

/** A Tab's turn in the Session, and what starts only while the Session is
 * not ending. */
type Turns = { readonly inTurn: InTurn; readonly unlessEnding: InTurn };

/**
 * The turn of one Tab in the Session, where the Session's end stops a
 * listing or Run still waiting: the Host's own wait cannot be stopped, and
 * a joined browser stays open. Work whose turn comes once the Session is
 * `ending` never starts; the end answers it, as a request answered while it
 * waited never starts either.
 */
function turns(ending: Effect.Effect<boolean>): Turns {
  const turn = Semaphore.makeUnsafe(1);
  const unlessEnding: InTurn = (work) =>
    ending.pipe(Effect.flatMap((ends) => (ends ? Effect.never : work)));
  return {
    unlessEnding,
    inTurn: (work) =>
      Semaphore.withPermit(
        turn,
        unlessEnding(
          Effect.gen(function* () {
            const request = yield* Answered;
            if (request.answered) return yield* Effect.interrupt;
            request.started = true;
            return yield* work;
          })
        )
      ),
  };
}

/** `hosted`, whose listings, Runs and Inspector Runs wait for the Tab's
 * turn, as `inTurn` takes it, and whose other Inspector calls start only
 * `unlessEnding`. Work of a Run goes on in `scope`. */
function inTurns(
  hosted: SwappingTab,
  { inTurn, unlessEnding }: Turns,
  scope: Scope.Scope
): SwappingTab {
  // A Run answered by an error while its own work is still `going` keeps
  // the turn, in `scope`, until that work ends, as one stopped at a dialog
  // does: the Swap and the next Run come after it.
  const run = <A, E extends { readonly going?: Promise<unknown> }>(
    work: Effect.Effect<A, E>
  ) =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<A, E>();
      yield* inTurn(
        work.pipe(
          Effect.onExit((exit) => Deferred.done(answer, exit)),
          Effect.tapError(({ going }) =>
            going ? Effect.promise(() => going.catch(() => {})) : Effect.void
          )
        )
      ).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
            ? Deferred.interrupt(answer)
            : Effect.void
        ),
        Effect.exit,
        Effect.forkIn(scope)
      );
      return yield* Deferred.await(answer);
    });
  return {
    listing: inTurn(hosted.listing),
    call: (tool, input) => run(hosted.call(tool, input)),
    // A Run from the Inspector window takes the turn; its reads do not,
    // and start no JavaScript, which an interrupt cannot stop, once ending.
    inspector: {
      ...hosted.inspector,
      request: (method, params) =>
        method === "runTool"
          ? run(hosted.inspector.request(method, params))
          : unlessEnding(hosted.inspector.request(method, params)),
    },
    dialog: hosted.dialog,
    takesId: hosted.takesId,
    buildLine: hosted.buildLine,
  };
}

/** Whether the Session already answered the request whose work this is,
 * and whether that work had the Tab's turn: work still waiting for it then
 * never starts, since its Caller may have run the command again meanwhile. */
const Answered = Context.Reference<{ answered: boolean; started: boolean }>(
  "@ayme-dev/session/session/Answered",
  { defaultValue: () => ({ answered: false, started: false }) }
);

// The window's requests its Tab's Host answers from what it already holds,
// without the page a dialog holds: the Runs, the recorded page state and
// the Page Objects' definitions.
const offPage = new Set(["getState", "recordedPageState", "pomDefinitionText"]);

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
 * `hosted`, whose requests are answered that a dialog is open once one
 * counts on its Tab (rules 4 and 5), at once or while they wait or run.
 * Work already under way keeps the Tab's turn in `scope` until it ends, so
 * the next Run starts only once a stopped action has ended; work still
 * waiting never starts, since its Caller may run the command again. A
 * listing names the Tab by `tab`'s URL, since its title is the page's, which
 * the dialog holds.
 */
function atDialogs(
  hosted: SwappingTab,
  tab: BrowserTab,
  scope: Scope.Scope
): SwappingTab {
  const counted = hosted.dialog.pipe(Stream.filter((now) => now !== "opening"));
  const atDialog = <A, E>(
    work: Effect.Effect<A, E>,
    refused: (dialog: Dialog, started: boolean) => E,
    closed: E,
    read = false
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const now = yield* Effect.raceFirst(
        Stream.runHead(counted),
        tab.closed.pipe(Effect.andThen(Effect.fail(closed)))
      );
      if (Option.isSome(now) && isOpen(now.value))
        return yield* Effect.fail(refused(now.value.open, false));
      const request = { answered: false, started: false };
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
                Effect.andThen(
                  Effect.fail(refused(open.value.open, request.started))
                )
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
      const raced = Effect.raceFirst(answer, opened);
      // A read is ayme's own work, not an action: it is released with
      // whoever asked for it, such as a window that closed, and once a
      // dialog answered them, so it holds no Swap behind the dialog. A Run
      // goes on, as it does once a dialog answered its Caller.
      return yield* read
        ? raced.pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) ? Effect.void : Fiber.interrupt(working)
            )
          )
        : raced;
    });
  // A command whose work had started may have changed the page; one still
  // waiting can be run again.
  const atRun = (dialog: Dialog, started: boolean) =>
    started ? dialogOpenAtRun(dialog) : dialogOpen(dialog);
  return {
    listing: atDialog(
      hosted.listing,
      (dialog) => new TabReadError(dialogOpenInListing(tab.url(), dialog)),
      new TabReadError(TAB_CLOSED),
      true
    ),
    call: (tool, input) =>
      atDialog(
        hosted.call(tool, input),
        (dialog, started) => new RunError(atRun(dialog, started)),
        new RunError(TAB_CLOSED)
      ),
    inspector: {
      ...hosted.inspector,
      request: (method, params) =>
        offPage.has(method)
          ? hosted.inspector.request(method, params)
          : atDialog(
              hosted.inspector.request(method, params),
              (dialog, started) =>
                new TabReadError(
                  atRun(dialog, method === "runTool" && started)
                ),
              new TabReadError(TAB_CLOSED),
              method !== "runTool"
            ),
    },
    dialog: hosted.dialog,
    takesId: hosted.takesId,
    buildLine: hosted.buildLine,
  };
}

/** Why a start failed, also when it broke in a way nobody expected. */
export const whyNotStarted = (
  cause: Cause.Cause<SessionStartError>
): SessionStartError =>
  Option.getOrElse(Cause.findErrorOption(cause), () =>
    brokenStart(Cause.squash(cause))
  );
