import type { JsonValue } from "./contracts";
import { errorText } from "./errors";
import type { Caller } from "./run";

/** A top-level Run in the document's Run log, as it stood when listed. */
export type Run = Readonly<{
  /** Unique within the document. */
  id: string;
  /** The tool's unprefixed name. */
  tool: string;
  /** The input it was started with, as JSON; absent for `undefined`. */
  input?: JsonValue;
  /** Its Caller. */
  by: Caller;
  status: "running" | "succeeded" | "failed";
  /**
   * What it returned, as JSON captured when it returned, so a later change
   * to the returned value doesn't change it. Absent for `undefined`.
   */
  result?: JsonValue;
  /** Why it failed: the error's message, prefixed with its name unless that is plain "Error". */
  error?: string;
  /** When it started, in epoch milliseconds. */
  startedAt: number;
  /** How long it took; absent while it runs. */
  durationMs?: number;
}>;

/** The document's Run log: its Runs, oldest first. */
export type AymeRuns = {
  /** The same array comes back until a Run starts or ends. */
  list(): readonly Run[];
  /** Calls `listener` with the new list after a Run starts or ends. */
  subscribe(listener: (runs: readonly Run[]) => void): () => void;
};

/** How many top-level Runs a document's log keeps, the newest. */
const KEPT_RUNS = 200;

const NO_RUNS: readonly Run[] = Object.freeze([]);

/**
 * Package-internal: the document's Run log. A module instance lives as long
 * as its document, so a cross-document navigation starts an empty one.
 */
export const runLog = createRunLog();

function createRunLog() {
  let runs = NO_RUNS;
  let nextId = 1;
  const listeners = new Set<(runs: readonly Run[]) => void>();

  function publish(next: Run[]) {
    // A Run that ended after retention dropped it changes nothing.
    if (next.every((run, index) => run === runs[index])) return;
    runs = Object.freeze(next);
    for (const listener of listeners) listener(runs);
  }

  const log: AymeRuns & {
    /** Records `execute` as a Run of `tool` for `by`, and returns its answer. */
    record<T>(
      tool: string,
      input: unknown,
      by: Caller,
      execute: () => Promise<T>
    ): Promise<T>;
  } = {
    list: () => runs,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async record(tool, input, by, execute) {
      const id = String(nextId++);
      const started = performance.now();
      publish(
        [
          ...runs,
          withJson(
            { id, tool, by, status: "running", startedAt: Date.now() },
            "input",
            input
          ),
        ].slice(-KEPT_RUNS)
      );
      const end = (ended: Partial<Run>) =>
        publish(
          runs.map((run) =>
            run.id === id
              ? Object.freeze({
                  ...run,
                  ...ended,
                  durationMs: performance.now() - started,
                })
              : run
          )
        );
      let answer;
      try {
        answer = await execute();
      } catch (error) {
        end({ status: "failed", error: errorText(error) });
        throw error;
      }
      end(withJson({ status: "succeeded" }, "result", answer));
      return answer;
    },
  };
  return log;
}

/**
 * `fields` with `key` set to `value` captured as JSON, unless it has none
 * (`undefined`) or cannot be written as JSON.
 */
function withJson<F extends object>(fields: F, key: string, value: unknown) {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  return Object.freeze(
    json === undefined ? fields : { ...fields, [key]: JSON.parse(json) }
  ) as F & Partial<Run>;
}
