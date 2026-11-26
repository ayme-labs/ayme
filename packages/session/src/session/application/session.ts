import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Scope,
  Stream,
} from "effect";

import {
  brokenStart,
  callAnswer,
  endAnswer,
  endedAtStart,
  endedBeforeAnswer,
  failed,
  type Listing,
  openedAnswer,
  pageObjectsAnswer,
  runFailed,
  toolsAnswer,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
  SessionStartError,
  unknownRequest,
} from "../domain";
import { PageObjectsBuild } from "./pageObjectsBuild";
import {
  SessionBrowser,
  type HeldBrowser,
  type HostedTab,
  type SessionBrowserRequest,
} from "./sessionBrowser";

/** What a Session has once it started: its browser, and the Tab it is the
 * Host of. */
type Started = { readonly held: HeldBrowser; readonly tab: HostedTab };

/** What a Session tells as it goes. Nothing yet: the Inspector's events
 * join it. */
export type SessionEvent = never;

/** One running ayme connected to one browser. */
export interface Session {
  /** The answer to the command that started the Session, once its start
   * succeeded or failed. */
  readonly started: Effect.Effect<SessionAnswer>;
  /** Answers one request, after the start: a request that arrives while
   * the Session starts waits for it. Always answers. */
  readonly ask: (request: SessionRequest) => Effect.Effect<SessionAnswer>;
  readonly events: Stream.Stream<SessionEvent>;
  readonly ended: Effect.Effect<SessionEnd>;
}

/**
 * Starts a Session on the browser `request` asks for, running the
 * project's Page Objects there once they are built. It returns at once,
 * while the Session starts, and the Session ends at the latest when the
 * scope closes.
 */
export const openSession = (
  request: SessionBrowserRequest
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
        held.host(built).pipe(Effect.map((tab): Started => ({ held, tab })))
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

    /** A listing of the Tab, answered by `answer`. */
    const listed = (
      { tab }: Started,
      answer: (listing: Listing) => SessionAnswer
    ) =>
      tab.listing.pipe(
        Effect.map(answer),
        Effect.catch((error) => Effect.succeed(failed(error.message)))
      );

    const answerTo = (
      request: Exclude<SessionRequest, { readonly stop: unknown }>,
      started: Started
    ): Effect.Effect<SessionAnswer> => {
      if ("pageObjects" in request) return listed(started, pageObjectsAnswer);
      if ("tools" in request) return listed(started, toolsAnswer);
      if ("call" in request)
        return started.tab.call(request.call.tool, request.call.input).pipe(
          Effect.map(callAnswer),
          Effect.catch((error) => Effect.succeed(runFailed(error)))
        );
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
            return openedAnswer(held.address);
          return failed(endedAtStart(yield* Deferred.await(ended)));
        })
      ),
      // A stop ends a start under way at once; any other request waits for
      // the start.
      ask: (request) =>
        "stop" in request
          ? end("stopped").pipe(
              Effect.flatMap((how) =>
                how === "start failed"
                  ? afterStart(() => Effect.succeed(endAnswer(how)))
                  : Effect.succeed(endAnswer(how))
              )
            )
          : afterStart((started) => untilEnd(answerTo(request, started))),
      events: Stream.never.pipe(Stream.interruptWhen(Deferred.await(ended))),
      ended: Deferred.await(ended),
    };
  });

/** Why a start failed, also when it broke in a way nobody expected. */
export const whyNotStarted = (
  cause: Cause.Cause<SessionStartError>
): SessionStartError =>
  Option.getOrElse(Cause.findErrorOption(cause), () =>
    brokenStart(Cause.squash(cause))
  );
