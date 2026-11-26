import { Deferred, Effect, Exit, Scope, Stream } from "effect";

import {
  endAnswer,
  failed,
  openedAnswer,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
  type SessionStartError,
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

    // The first end closes the browser; any later one waits for it.
    const end = (how: SessionEnd) =>
      Effect.gen(function* () {
        if (yield* Deferred.succeed(ending, undefined)) {
          yield* Scope.close(browserScope, Exit.void);
          yield* Deferred.succeed(ended, how);
        }
        return yield* Deferred.await(ended);
      });

    yield* browsers.get(request).pipe(
      Scope.provide(browserScope),
      Effect.matchEffect({
        onFailure: (error) =>
          Deferred.fail(browser, error).pipe(
            Effect.andThen(end("start failed"))
          ),
        onSuccess: (held) =>
          Deferred.succeed(browser, held).pipe(
            Effect.andThen(held.gone),
            Effect.andThen(end("browser gone"))
          ),
      }),
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
      started: afterStart((held) => Effect.succeed(openedAnswer(held.address))),
      ask: (request) =>
        afterStart(() =>
          "stop" in request
            ? end("stopped").pipe(Effect.map(endAnswer))
            : Effect.succeed(unknownRequest)
        ),
      events: Stream.never.pipe(Stream.interruptWhen(Deferred.await(ended))),
      ended: Deferred.await(ended),
    };
  });
