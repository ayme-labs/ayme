// The background process of a Session: it serves one Session to the
// commands of its project folder until the Session ends.
import { rmSync } from "node:fs";
import type { Server } from "node:net";
import { Deferred, Effect, type Scope } from "effect";

import {
  openSession,
  type PageObjectsBuild,
  type Session,
  type SessionBrowser,
  type SessionBrowserRequest,
} from "../../session/application";
import { projectPageObjects } from "../../page-objects/infrastructure";
import { stockBrowser } from "../../playwright/infrastructure";
import { SessionStartError } from "../../session/domain";
import { alreadyOpen, claimRecord, releaseRecord, socketFile } from "./record";
import { listen } from "./wire";

/** What the background process is started with. */
export type SessionProcessOptions = {
  readonly projectDir: string;
  readonly request: SessionBrowserRequest;
};

const closed = (server: Server) =>
  Effect.callback<void>((resume) => {
    // Resolves once every command still connected has its answer.
    server.close(() => resume(Effect.void));
  });

/**
 * Starts a Session and makes it the folder's: once this returns, the
 * folder's commands reach it. The scope ends it, and the folder then has no
 * Session. Fails when the folder already has one.
 */
export const serveSession = ({
  projectDir,
  request,
}: SessionProcessOptions): Effect.Effect<
  Session,
  SessionStartError,
  SessionBrowser | PageObjectsBuild | Scope.Scope
> =>
  Effect.gen(function* () {
    const pid = process.pid;
    const socket = socketFile(projectDir, pid);
    const served = yield* Deferred.make<Session>();
    // Listening comes first, so that a command that finds the record
    // reaches the process.
    yield* Effect.acquireRelease(
      Effect.promise(() => {
        rmSync(socket, { force: true });
        return listen(socket, (asked) =>
          Effect.runPromise(
            Deferred.await(served).pipe(
              Effect.flatMap((session) =>
                "started" in asked ? session.started : session.ask(asked)
              )
            )
          )
        );
      }),
      (server) =>
        closed(server).pipe(
          Effect.andThen(Effect.sync(() => rmSync(socket, { force: true })))
        )
    );
    const holder = claimRecord(projectDir, { pid, socket });
    if (holder)
      return yield* Effect.fail(
        new SessionStartError(alreadyOpen(projectDir, holder))
      );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => releaseRecord(projectDir, pid))
    );
    const session = yield* openSession(request);
    yield* Deferred.succeed(served, session);
    return session;
  });

/**
 * The background process itself: serves the Session `options` asks for
 * until it ends, and resolves with the process's exit code. A Session that
 * cannot start is told on stderr, which the starting command reads.
 * `aymeVersion` is the version of the ayme the process runs, which the
 * project's own `@ayme-dev/ayme` must have.
 */
export function runSessionProcess(
  options: SessionProcessOptions,
  aymeVersion: string
): Promise<number> {
  return Effect.runPromise(
    serveSession(options).pipe(
      Effect.tap((session) =>
        Effect.sync(() => {
          // The process is told to end as a Caller's stop.
          for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
            process.once(signal, () => {
              void Effect.runPromise(session.ask({ stop: {} }));
            });
        })
      ),
      Effect.flatMap((session) => session.ended),
      Effect.map((end) => (end === "start failed" ? 1 : 0)),
      Effect.catch((error) =>
        Effect.sync(() => {
          process.stderr.write(`${error.message}\n`);
          return 1;
        })
      ),
      Effect.provide(stockBrowser(options.projectDir)),
      Effect.provide(projectPageObjects(options.projectDir, aymeVersion)),
      Effect.scoped
    )
  );
}
