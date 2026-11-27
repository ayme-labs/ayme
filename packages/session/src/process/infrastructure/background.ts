// The background process of a Session: it serves one Session to the
// commands of its project folder until the Session ends.
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { Deferred, Effect, Layer, type Scope } from "effect";

import {
  openSession,
  type PageObjectsBuild,
  whyNotStarted,
  type Session,
  type SessionBrowser,
  type SessionBrowserRequest,
} from "../../session/application";
import { projectPageObjects } from "../../page-objects/infrastructure";
import { failItsRun, stockBrowser } from "../../playwright/infrastructure";
import {
  failed,
  SessionStartError,
  type SessionAnswer,
} from "../../session/domain";
import {
  markStarted,
  nameOf,
  releaseRecord,
  type SessionPlace,
} from "./record";
import { serveInspectorWindow } from "./inspectorWindow";
import { listen } from "./wire";

/** What the command that starts a Session tells its process, over the
 * process's IPC channel: which claim of the folder is the process's. The
 * process answers with the SessionAnswer to the start. */
export type FromOpener = { readonly claimed: number };

/** The command that started the process, as the process reaches it: over
 * the process's IPC channel. */
export type Opener = Pick<
  NodeJS.Process,
  "connected" | "once" | "off" | "send" | "disconnect"
>;

/** What a Session's process is started with. */
type ProcessOptions = SessionPlace & {
  readonly request: SessionBrowserRequest;
  /** The socket to listen on, in a folder of the Session's own. */
  readonly socket: string;
};

// A local socket's path, in bytes, less the zero that ends it.
const MAX_SOCKET_PATH = process.platform === "darwin" ? 103 : 107;

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Starts the Session named `name` and serves it on `socket`: once this
 * returns, commands reach it there, and a request waits for the start. With
 * `inspectorScript`, the Inspector's built script, it also serves the
 * Session's Inspector window. The scope ends it.
 */
export const serveSession = ({
  socket,
  request,
  name,
  inspectorScript,
}: Omit<ProcessOptions, keyof SessionPlace> & {
  readonly name: string;
  readonly inspectorScript?: string;
}): Effect.Effect<
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
    const window =
      inspectorScript === undefined
        ? undefined
        : yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                serveInspectorWindow({ name, script: inspectorScript }),
              catch: (cause) =>
                new SessionStartError(
                  `ayme could not serve the Session's Inspector window: ${messageOf(cause)}`
                ),
            }),
            (served) => Effect.promise(() => served.close())
          );
    const session = yield* openSession(
      request,
      name,
      window ? { inspector: window.address } : {}
    );
    window?.attach(session);
    yield* Deferred.succeed(served, session);
    return session;
  });

/** The claim the starting command gives this process, or undefined when
 * that command went away first. */
const claimed = (opener: Opener) =>
  new Promise<number | undefined>((resolve) => {
    if (!opener.connected) return resolve(undefined);
    opener.once("message", (message: FromOpener) => resolve(message.claimed));
    opener.once("disconnect", () => resolve(undefined));
  });

/** Tells the starting command how the start ended, if it is still there. */
const tell = (opener: Opener, answer: SessionAnswer) =>
  Effect.sync(() => {
    if (opener.connected) opener.send!(answer, () => opener.disconnect());
  });

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Keeps the process alive through an error or a rejection that nothing
 * caught, such as one Page Object code left behind: it ends only its own
 * Run, never the Session (rule 12). Node would otherwise end the process.
 * Each fails the Run it came from, if that Run is still under way, and
 * goes to the process's log.
 */
function catchWhatNothingCaught(): void {
  const log = (error: unknown) => {
    failItsRun(error);
    console.error("ayme caught an error nothing else caught:", error);
  };
  process.on("uncaughtException", log);
  process.on("unhandledRejection", log);
}

/**
 * The background process itself: serves the Session `options` asks for
 * until it ends, and resolves with the process's exit code. The command
 * that started it is told how the start ended over the IPC channel, on
 * every way out of the start. `aymeVersion` is the version of the ayme the
 * process runs, which the project's own `@ayme-dev/ayme` must have, and
 * `inspectorScript` the Inspector's built script, which its window loads.
 */
export const runSessionProcess = (
  options: ProcessOptions,
  aymeVersion: string,
  inspectorScript: string
): Promise<number> =>
  serveProcess(
    { ...options, inspectorScript },
    process,
    Layer.merge(
      stockBrowser(options.projectDir),
      projectPageObjects(options.projectDir, aymeVersion)
    )
  );

/** The background process on the browser and build `layer` gives, for the
 * command `opener` that started it. */
export async function serveProcess(
  options: ProcessOptions & { readonly inspectorScript?: string },
  opener: Opener,
  layer: Layer.Layer<SessionBrowser | PageObjectsBuild>
): Promise<number> {
  const generation = await claimed(opener);
  if (generation === undefined) return 1;
  catchWhatNothingCaught();
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          rmSync(dirname(options.socket), { recursive: true, force: true });
          releaseRecord(options, generation);
        })
      );
      const session = yield* serveSession({
        ...options,
        name: nameOf(options),
      });
      // The process is told to end as a Caller's stop, and so is a start
      // whose command went away before its answer.
      const stop = () => void Effect.runPromise(session.ask({ stop: {} }));
      for (const signal of SIGNALS) process.once(signal, stop);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const signal of SIGNALS) process.off(signal, stop);
        })
      );
      opener.once("disconnect", stop);
      // An opener gone before that has no disconnect left to tell.
      if (!opener.connected) stop();
      const answer = yield* session.started;
      opener.off("disconnect", stop);
      // Before the answer, so that `ayme list` no longer shows it as
      // starting once the start is answered.
      if (answer.ok) markStarted(options, generation);
      yield* tell(opener, answer);
      yield* session.ended;
      return answer.ok ? 0 : 1;
    }).pipe(
      Effect.catchCause((cause) =>
        tell(opener, failed(whyNotStarted(cause).message)).pipe(Effect.as(1))
      ),
      Effect.provide(layer),
      Effect.scoped
    )
  );
}
