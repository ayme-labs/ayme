import { Deferred, Effect, Exit, Scope, Stream } from "effect";

import {
  endAnswer,
  failed,
  type Listing,
  openedAnswer,
  pageObjectsAnswer,
  toolsAnswer,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
  type SessionStartError,
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

    // The build reads no page, so it runs while the browser opens; the
    // first to fail ends the start, and the browser closes with its scope.
    yield* Effect.all([browsers.get(request), pageObjects.build], {
      concurrency: "unbounded",
    }).pipe(
      Effect.flatMap(([held, built]) =>
        held.host(built).pipe(Effect.map((tab) => ({ held, tab })))
      ),
      Scope.provide(browserScope),
      Effect.matchEffect({
        onFailure: (error) =>
          Deferred.fail(start, error).pipe(Effect.andThen(end("start failed"))),
        onSuccess: (started) =>
          Deferred.succeed(start, started).pipe(
            Effect.andThen(started.held.gone),
            Effect.andThen(end("browser gone"))
          ),
      }),
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
      request: SessionRequest,
      started: Started
    ): Effect.Effect<SessionAnswer> => {
      if ("stop" in request) return end("stopped").pipe(Effect.map(endAnswer));
      if ("pageObjects" in request) return listed(started, pageObjectsAnswer);
      if ("tools" in request) return listed(started, toolsAnswer);
      return Effect.succeed(unknownRequest);
    };

    return {
      started: afterStart(({ held }) =>
        Effect.succeed(openedAnswer(held.address))
      ),
      ask: (request) => afterStart((started) => answerTo(request, started)),
      events: Stream.never.pipe(Stream.interruptWhen(Deferred.await(ended))),
      ended: Deferred.await(ended),
    };
  });
