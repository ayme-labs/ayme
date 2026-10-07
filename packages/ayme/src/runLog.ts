import type { JsonValue } from "./contracts";
import { errorText } from "./errors";
import type { Interaction } from "./interactions";
import type { Caller } from "./run";

/**
 * A Run in the document's Run log, as it stood when listed: a top-level Run,
 * which names its Caller, or a child Run, which a tool started through the
 * `run` in its context and which names its parent instead.
 */
export type Run = Readonly<
  RunFields &
    (
      | {
          /** A top-level Run's Caller. */
          by: Caller;
          parent?: undefined;
        }
      | {
          /** A child Run's parent: the id of the Run that started it. */
          parent: string;
          by?: undefined;
        }
    )
>;

type RunFields = {
  /** Unique within the document. */
  id: string;
  /** The tool's unprefixed name. */
  tool: string;
  /** The input it was started with, as JSON; absent for `undefined`. */
  input?: JsonValue;
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
  /**
   * The Interactions it performed itself on the runtime's Page, in order:
   * its child Runs' are theirs, not its own.
   */
  interactions: readonly Interaction[];
};

/** Package-internal: who starts a Run, its Caller or its parent Run. */
export type RunOrigin = { by: Caller } | { parent: string };

/**
 * The document's Run log: its Runs, oldest first, each child Run after the
 * Run that started it.
 */
export type AymeRuns = {
  /** The same array comes back until a Run starts, gains an Interaction, or ends. */
  list(): readonly Run[];
  /**
   * Calls `listener` with the new list after a Run starts, gains an
   * Interaction, or ends.
   */
  subscribe(listener: (runs: readonly Run[]) => void): () => void;
};

/**
 * How many top-level Runs a document's log keeps, the newest, each with its
 * child Runs.
 */
const KEPT_RUNS = 200;

const NO_RUNS: readonly Run[] = Object.freeze([]);
const NO_INTERACTIONS: readonly Interaction[] = Object.freeze([]);

/**
 * Package-internal: the document's Run log. A module instance lives as long
 * as its document, so a cross-document navigation starts an empty one.
 */
export const runLog = createRunLog();

function createRunLog() {
  let runs = NO_RUNS;
  let nextId = 1;
  /** The top-level Run each Run belongs to, by id: itself for a top-level Run. */
  const roots = new Map<string, string>();
  /**
   * The ids of the Runs running now, outermost first. Top-level Runs take
   * turns and a child Run runs inside its parent's turn, so the last one is
   * the Run whose code is running: the innermost.
   */
  const running: string[] = [];
  const listeners = new Set<(runs: readonly Run[]) => void>();

  function publish(next: Run[]) {
    // A Run that ended after retention dropped it changes nothing.
    if (next.every((run, index) => run === runs[index])) return;
    runs = Object.freeze(next);
    for (const listener of listeners) listener(runs);
  }

  /**
   * `next` without the oldest top-level Runs past `KEPT_RUNS`, each dropped
   * with its child Runs. A child Run whose parent is gone is dropped too.
   */
  function retained(next: Run[]): Run[] {
    const kept = new Set(
      next
        .filter((run) => run.parent === undefined)
        .slice(-KEPT_RUNS)
        .map((run) => run.id)
    );
    for (const id of roots.keys())
      if (!kept.has(roots.get(id)!)) roots.delete(id);
    return next.filter((run) => roots.has(run.id));
  }

  const log: AymeRuns & {
    /**
     * Records `execute` as a Run of `tool`, started by `origin`, and returns
     * its answer. `execute` is handed the Run's id.
     */
    record<T>(
      tool: string,
      input: unknown,
      origin: RunOrigin,
      execute: (id: string) => Promise<T>
    ): Promise<T>;
    /**
     * Records `interaction` as the innermost running Run's. Outside every
     * Run it is no one's, and is not recorded.
     */
    interact(interaction: Interaction): void;
  } = {
    list: () => runs,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async record(tool, input, origin, execute) {
      const id = String(nextId++);
      const started = performance.now();
      roots.set(id, "parent" in origin ? (roots.get(origin.parent) ?? "") : id);
      publish(
        retained([
          ...runs,
          withJson(
            {
              id,
              tool,
              ...origin,
              status: "running",
              startedAt: Date.now(),
              interactions: NO_INTERACTIONS,
            },
            "input",
            input
          ) as Run,
        ])
      );
      running.push(id);
      const end = (ended: Partial<RunFields>) => {
        running.splice(running.lastIndexOf(id), 1);
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
      };
      let answer;
      try {
        answer = await execute(id);
      } catch (error) {
        end({ status: "failed", error: errorText(error) });
        throw error;
      }
      end(withJson({ status: "succeeded" }, "result", answer));
      return answer;
    },
    interact(interaction) {
      const id = running.at(-1);
      if (id === undefined) return;
      const recorded = Object.freeze({ ...interaction });
      publish(
        runs.map((run) =>
          run.id === id
            ? Object.freeze({
                ...run,
                interactions: Object.freeze([...run.interactions, recorded]),
              })
            : run
        )
      );
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
  ) as F & Partial<RunFields>;
}
