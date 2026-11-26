// The background process of a Session: it serves one Session to the
// commands of its project folder until the Session ends.
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { Deferred, Effect, type Scope } from "effect";

import {
  openSession,
  type PageObjectsBuild,
  whyNotStarted,
  type Session,
  type SessionBrowser,
  type SessionBrowserRequest,
} from "../../session/application";
import { projectPageObjects } from "../../page-objects/infrastructure";
import { stockBrowser } from "../../playwright/infrastructure";
import {
  failed,
  SessionStartError,
  type SessionAnswer,
} from "../../session/domain";
import { releaseRecord } from "./record";
import { listen } from "./wire";

/** What the command that starts a Session tells its process, over the
 * process's IPC channel: which claim of the folder is the process's. The
 * process answers with the SessionAnswer to the start. */
export type FromOpener = { readonly claimed: number };

/** What a Session's process is started with. */
type ProcessOptions = {
  readonly projectDir: string;
  readonly request: SessionBrowserRequest;
  /** The socket to listen on, in a folder of the Session's own. */
  readonly socket: string;
};

// A local socket's path, in bytes, less the zero that ends it.
const MAX_SOCKET_PATH = process.platform === "darwin" ? 103 : 107;

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Starts a Session and serves it on `socket`: once this returns, commands
 * reach it there, and a request waits for the start. The scope ends it.
 */
export const serveSession = ({
  socket,
  request,
}: Omit<ProcessOptions, "projectDir">): Effect.Effect<
  Session,
  SessionStartError,
  SessionBrowser | PageObjectsBuild | Scope.Scope
> =>
  Effect.gen(function* () {
    if (Buffer.byteLength(socket) > MAX_SOCKET_PATH)
      return yield* Effect.fail(
        new SessionStartError(
          `ayme cannot listen at ${socket}: a local socket's path has at most ${MAX_SOCKET_PATH} bytes. Set TMPDIR to a shorter folder.`
        )
      );
    const served = yield* Deferred.make<Session>();
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          listen(socket, (asked) =>
            Effect.runPromise(
              Deferred.await(served).pipe(
                Effect.flatMap((session) => session.ask(asked))
              )
            )
          ),
        catch: (cause) =>
          new SessionStartError(
            `ayme could not listen at ${socket}: ${messageOf(cause)}`
          ),
      }),
      (listening) => Effect.promise(() => listening.close())
    );
    const session = yield* openSession(request);
    yield* Deferred.succeed(served, session);
    return session;
  });

/** The claim the starting command gives this process, or undefined when
 * that command went away first. */
const claimed = () =>
  new Promise<number | undefined>((resolve) => {
    if (!process.connected) return resolve(undefined);
    process.once("message", (message: FromOpener) => resolve(message.claimed));
    process.once("disconnect", () => resolve(undefined));
  });

/** Tells the starting command how the start ended, if it is still there. */
const tell = (answer: SessionAnswer) =>
  Effect.sync(() => {
    if (process.connected) process.send!(answer, () => process.disconnect());
  });

/**
 * Keeps the process alive through an error or a rejection that nothing
 * caught, such as one Page Object code left behind: it ends only its own
 * Run, never the Session (rule 12). Node would otherwise end the process.
 * Each goes to the process's log.
 */
function catchWhatNothingCaught(): void {
  const log = (error: unknown) =>
    console.error("ayme caught an error nothing else caught:", error);
  process.on("uncaughtException", log);
  process.on("unhandledRejection", log);
}

/**
 * The background process itself: serves the Session `options` asks for
 * until it ends, and resolves with the process's exit code. The command
 * that started it is told how the start ended over the IPC channel, on
 * every way out of the start. `aymeVersion` is the version of the ayme the
 * process runs, which the project's own `@ayme-dev/ayme` must have.
 */
export async function runSessionProcess(
  options: ProcessOptions,
  aymeVersion: string
): Promise<number> {
  const generation = await claimed();
  if (generation === undefined) return 1;
  catchWhatNothingCaught();
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          rmSync(dirname(options.socket), { recursive: true, force: true });
          releaseRecord(options.projectDir, generation);
        })
      );
      const session = yield* serveSession(options);
      // The process is told to end as a Caller's stop, and so is a start
      // whose command went away before its answer.
      const stop = () => void Effect.runPromise(session.ask({ stop: {} }));
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
        process.once(signal, stop);
      process.once("disconnect", stop);
      const answer = yield* session.started;
      process.off("disconnect", stop);
      yield* tell(answer);
      yield* session.ended;
      return answer.ok ? 0 : 1;
    }).pipe(
      Effect.catchCause((cause) =>
        tell(failed(whyNotStarted(cause).message)).pipe(Effect.as(1))
      ),
      Effect.provide(stockBrowser(options.projectDir)),
      Effect.provide(projectPageObjects(options.projectDir, aymeVersion)),
      Effect.scoped
    )
  );
}
