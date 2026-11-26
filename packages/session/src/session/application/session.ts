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
  endAnswer,
  endedAtStart,
  failed,
  openedAnswer,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
  SessionStartError,
  unknownRequest,
} from "../domain";
import {
  SessionBrowser,
  type HeldBrowser,
  type SessionBrowserRequest,
} from "./sessionBrowser";

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
 * Starts a Session on the browser `request` asks for. It returns at once,
 * while the Session starts, and the Session ends at the latest when the
 * scope closes.
 */
export const openSession = (
  request: SessionBrowserRequest
): Effect.Effect<Session, never, SessionBrowser | Scope.Scope> =>
  Effect.gen(function* () {
    const browsers = yield* SessionBrowser;
    const scope = yield* Scope.Scope;
    const browserScope = yield* Scope.fork(scope);
    const browser = yield* Deferred.make<HeldBrowser, SessionStartError>();
    const ending = yield* Deferred.make<void>();
    const ended = yield* Deferred.make<SessionEnd>();

    const starting = yield* browsers
      .get(request)
      .pipe(Scope.provide(browserScope), Effect.forkIn(scope));

    // The first end stops a start still under way and closes the browser;
    // any later one waits for it.
    const end = (how: SessionEnd) =>
      Effect.gen(function* () {
        if (yield* Deferred.succeed(ending, undefined)) {
          yield* Fiber.interrupt(starting);
          yield* Deferred.fail(
            browser,
            new SessionStartError(endedAtStart(how))
          );
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
          onSuccess: (held) =>
            held.gone.pipe(
              Effect.andThen(end("browser gone")),
              Effect.forkIn(scope),
              Effect.andThen(Effect.yieldNow),
              Effect.andThen(Deferred.succeed(browser, held))
            ),
          onFailure: (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Deferred.fail(browser, whyNotStarted(cause)).pipe(
                  Effect.andThen(end("start failed"))
                ),
        })
      ),
      Effect.forkIn(scope)
    );

    const afterStart = (
      answer: (held: HeldBrowser) => Effect.Effect<SessionAnswer>
    ) =>
      Deferred.await(browser).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(failed(error.message)),
          onSuccess: answer,
        })
      );

    return {
      // A browser that went away before the start was answered is no
      // Session (rule 2).
      started: afterStart((held) =>
        Effect.gen(function* () {
          if (!(yield* Deferred.isDone(ending)))
            return openedAnswer(held.address);
          return failed(endedAtStart(yield* Deferred.await(ended)));
        })
      ),
      ask: (request) =>
        "stop" in request
          ? end("stopped").pipe(
              Effect.flatMap((how) =>
                how === "start failed"
                  ? afterStart(() => Effect.succeed(endAnswer(how)))
                  : Effect.succeed(endAnswer(how))
              )
            )
          : afterStart(() => Effect.succeed(unknownRequest)),
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
