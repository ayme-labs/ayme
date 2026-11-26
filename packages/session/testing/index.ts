// Test support (ADR-0057): a real Session on a scripted browser, where a
// test plays the browser by hand.
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { onTestFinished } from "vitest";

import {
  openSession,
  SessionBrowser,
  type SessionBrowserRequest,
} from "../src/session/application";
import {
  SessionStartError,
  type SessionAnswer,
  type SessionEnd,
  type SessionRequest,
} from "../src/session/domain";

/** The address the scripted browser gives. */
export const SCRIPTED_ADDRESS = "http://127.0.0.1:9222";

/**
 * The remote control of a scripted browser. It opens at once, unless the
 * Session was started with `held: true`; then the test finishes the open
 * with `open` or `failOpen`.
 */
export interface ScriptedBrowser {
  /** Every browser the Session asked for, in order. */
  readonly asked: readonly SessionBrowserRequest[];
  /** Whether the Session has let its browser go, which closes a browser
   * ayme opened. */
  readonly released: boolean;
  /** A held open finishes: the browser is there. */
  open(): void;
  /** A held open fails, for the reason a person reads. */
  failOpen(reason: string): void;
  /** The browser goes away: it crashed, or someone closed it. */
  goAway(): void;
}

/** The Session's interface with each member as a promise. */
export interface ScriptedSession {
  readonly started: Promise<SessionAnswer>;
  ask(request: SessionRequest): Promise<SessionAnswer>;
  readonly ended: Promise<SessionEnd>;
}

export type ScriptedSessionOptions = SessionBrowserRequest & {
  /** The open waits for the test: `open` or `failOpen`. */
  readonly held?: true;
};

/** A scripted browser, as the layer a Session gets its browser from, and
 * its remote control. */
export function scriptedBrowser({ held }: { readonly held?: true } = {}): {
  layer: Layer.Layer<SessionBrowser>;
  browser: ScriptedBrowser;
} {
  const asked: SessionBrowserRequest[] = [];
  let released = false;
  const opened = Deferred.makeUnsafe<void, SessionStartError>();
  const gone = Deferred.makeUnsafe<void>();
  if (!held) Deferred.doneUnsafe(opened, Exit.void);

  const layer = Layer.succeed(SessionBrowser, {
    get: (asking) =>
      Effect.acquireRelease(
        Effect.sync(() => asked.push(asking)).pipe(
          Effect.andThen(Deferred.await(opened)),
          Effect.as({ address: SCRIPTED_ADDRESS, gone: Deferred.await(gone) })
        ),
        () => Effect.sync(() => (released = true))
      ),
  });

  return {
    layer,
    browser: {
      asked,
      get released() {
        return released;
      },
      open: () => Deferred.doneUnsafe(opened, Exit.void),
      failOpen: (reason) =>
        Deferred.doneUnsafe(opened, Exit.fail(new SessionStartError(reason))),
      goAway: () => Deferred.doneUnsafe(gone, Exit.void),
    },
  };
}

/** Starts a Session on a scripted browser. It ends when the test does. */
export async function startScriptedSession(
  options: ScriptedSessionOptions
): Promise<{ session: ScriptedSession; browser: ScriptedBrowser }> {
  const { held, ...request } = options;
  const { layer, browser } = scriptedBrowser(held ? { held } : {});
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
