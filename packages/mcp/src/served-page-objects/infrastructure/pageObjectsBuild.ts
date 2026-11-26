import { pathToFileURL } from "node:url";

import {
  buildLog,
  type PageObjectsBuildState,
  type SettledBuildState,
} from "../domain/buildState";
import {
  watchPageObjects,
  type PageObjectsBuildEvent,
  type PomCompilerEntry,
} from "./pageObjectsBundler";
import {
  projectAymeInstall,
  type ProjectAymeInstall,
} from "./projectAymeInstall";

/** The Page Objects entry's build, which rebuilds as its files change. */
export type PageObjectsBuild = {
  readonly state: PageObjectsBuildState;
  /** Waits for startup and the first build, checking for a changed install after a failed start. */
  whenSettled(): Promise<SettledBuildState>;
  /** Calls the listener on each change from now on; returns how to stop. */
  subscribe(listener: (state: PageObjectsBuildState) => void): () => void;
  close(): Promise<void>;
};

/** How long the install files stay unchanged before a start: an install writes them more than once. */
const SETTLED_MS = 100;

export function startPageObjects(
  entry: string,
  log: (message: string) => void,
  version: string
): PageObjectsBuild {
  return startWithInstall(
    entry,
    log,
    projectAymeInstall(entry, version),
    async (file, publish) => {
      const compiler = (await import(
        pathToFileURL(file).href
      )) as PomCompilerEntry;
      return watchPageObjects(entry, compiler, publish);
    }
  );
}

type StartBuild = (
  compiler: string,
  publish: (event: PageObjectsBuildEvent) => void
) => Promise<() => Promise<void>>;

/** Starts again after an install changes, even if the file watcher missed the change. */
export function startWithInstall(
  entry: string,
  log: (message: string) => void,
  install: ProjectAymeInstall,
  startBuild: StartBuild
): PageObjectsBuild {
  // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent, the first retry() below sets the starting state before anything reads this one.
  let state: PageObjectsBuildState = { kind: "starting", entry };
  const listeners = new Set<(state: PageObjectsBuildState) => void>();
  const setState = (next: PageObjectsBuildState) => {
    const previous = state;
    state = next;
    const message = buildLog(state, previous);
    if (message !== undefined) log(message);
    for (const listener of listeners) listener(state);
  };
  const subscribe = (listener: (state: PageObjectsBuildState) => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const publish = (event: PageObjectsBuildEvent) => {
    switch (event.kind) {
      case "building":
        if (state.kind === "starting") setState({ ...event, entry });
        break;
      case "built":
        setState({ ...event, entry });
        break;
      case "failed":
        setState(
          state.kind === "built" || state.kind === "rebuild-failed"
            ? {
                kind: "rebuild-failed",
                entry,
                modules: state.modules,
                errors: event.errors,
              }
            : { kind: "never-built", entry, errors: event.errors }
        );
        break;
    }
  };
  let closeBuild: (() => Promise<void>) | undefined;
  let lastProblem: string | undefined;
  let stopWatching = () => {};
  let closed = false;
  let attempt: Promise<void> | undefined;
  let settling: NodeJS.Timeout | undefined;
  // A change during an attempt starts another once it ends.
  let changedMeanwhile = false;

  const problemNow = async () => {
    const found = await install.resolve();
    return found.kind === "cannot-start" ? found.error : undefined;
  };
  const tryStart = async (previous: PageObjectsBuildState) => {
    let failure: string;
    try {
      const found = await install.resolve();
      if (found.kind === "ready") {
        closeBuild = await startBuild(found.compiler, publish);
        stopWatching();
        return;
      }
      failure = found.error;
      lastProblem = failure;
    } catch (error) {
      lastProblem = undefined;
      failure = (error as Error).message;
    }
    stopWatching();
    setState(watchInstall(previous, failure));
  };
  const watchInstall = (
    previous: PageObjectsBuildState,
    error: string
  ): SettledBuildState => {
    const stopped = { entry, error, kind: "cannot-start" } as const;
    if (closed) return stopped;
    try {
      const subscription = install.subscribe(
        () => {
          clearTimeout(settling);
          settling = setTimeout(retry, SETTLED_MS);
        },
        () => {
          if (state === watching) setState(stopped);
        },
        previous.kind === "watching-install" ? previous.installFiles : []
      );
      const watching = {
        entry,
        error,
        kind: "watching-install",
        installFiles: subscription.files,
      } as const;
      stopWatching = subscription.stop;
      return watching;
    } catch {
      return stopped;
    }
  };
  const retry = () => {
    if (closeBuild !== undefined || closed) return;
    if (attempt !== undefined) return void (changedMeanwhile = true);
    const previous = state;
    attempt = tryStart(previous).finally(() => {
      attempt = undefined;
      if (changedMeanwhile) {
        changedMeanwhile = false;
        retry();
      }
    });
    if (previous.kind !== "starting") setState({ kind: "starting", entry });
  };
  const attempted = async () => {
    while (attempt !== undefined) await attempt;
  };

  retry();
  return {
    get state() {
      return state;
    },
    subscribe,
    async whenSettled() {
      await attempted();
      const beforeCheck = state;
      if (
        !closed &&
        (beforeCheck.kind === "cannot-start" ||
          beforeCheck.kind === "watching-install") &&
        // A failed check leaves the state it has to answer with.
        (await problemNow().catch(() => lastProblem)) !== lastProblem &&
        state === beforeCheck
      ) {
        retry();
        await attempted();
      }
      if (isSettled(state)) return state;
      return new Promise((resolve) => {
        const stop = subscribe((next) => {
          if (!isSettled(next)) return;
          stop();
          resolve(next);
        });
      });
    },
    async close() {
      closed = true;
      clearTimeout(settling);
      stopWatching();
      await attempted();
      await closeBuild?.();
    },
  };
}

function isSettled(state: PageObjectsBuildState): state is SettledBuildState {
  return state.kind !== "starting" && state.kind !== "building";
}
