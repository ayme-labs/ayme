import type { Run as LogRun, callers } from "@ayme-dev/ayme";

import type { CollectionItem, Run, RunStep, ToolArguments } from "./run";

/** The Caller the panel's own runs name, as `callers` exports it. */
export const inspectorCaller: (typeof callers)["inspector"] = "inspector";

/** Whether a run was made from the panel. */
export function isPanelRun(run: Pick<Run, "by">): boolean {
  return run.by === inspectorCaller;
}

/** The Page Object Model and Page Object a Page Object tool runs on. */
export type RunTarget = { className: string; objectPath: string };

/**
 * What the panel knows of a Run beyond the log: the Page Object its tool
 * was on when the panel first saw it and, for a run made from the panel,
 * the item it ran on and the steps it performed.
 */
export type RunNotes = {
  target?: RunTarget;
  item?: CollectionItem;
  steps?: readonly RunStep[];
};

/**
 * A Run's row id: its log id with its start time, so it stays unique across
 * documents, whose logs each number their Runs from the start.
 */
export function rowIdOf(run: Pick<LogRun, "id" | "startedAt">): string {
  return `${run.id}@${run.startedAt}`;
}

/** A Run from the log as Runs shows it. */
function rowOf(run: LogRun, notes: RunNotes): Run {
  return {
    id: rowIdOf(run),
    toolName: run.tool,
    by: run.by,
    ...notes.target,
    ...(notes.item ? { item: notes.item, objectPath: notes.item.path } : {}),
    arguments: isArguments(run.input) ? run.input : {},
    status: run.status,
    ...(run.result === undefined
      ? {}
      : { result: JSON.stringify(run.result, null, 2) }),
    ...(run.error === undefined ? {} : { error: run.error }),
    startedAt: run.startedAt,
    ...(run.durationMs === undefined
      ? {}
      : { durationMs: Math.round(run.durationMs) }),
    steps: notes.steps ?? [],
  };
}

/**
 * The rows Runs shows, newest first: the log's Runs that started after
 * the panel was last cleared, with the panel's failed runs that never
 * reached the log, then the rows kept from earlier pages. A kept row that
 * is still in the log, as when the panel mounts again on the same page,
 * shows as the log's, with the notes it was kept with.
 */
export function shownRuns({
  log,
  notes,
  unlogged,
  earlier,
  clearedAt,
}: {
  /** The page's Run log, oldest first. */
  log: readonly LogRun[];
  notes: ReadonlyMap<string, RunNotes>;
  /** The panel's runs that failed before the log recorded them. */
  unlogged: readonly Run[];
  /** The rows kept from before the panel last mounted, newest first. */
  earlier: readonly Run[];
  /** When the panel was last cleared, in epoch milliseconds. */
  clearedAt: number;
}): Run[] {
  const kept = new Map(earlier.map((run) => [run.id, run]));
  const live = log
    .filter((run) => run.startedAt > clearedAt)
    .map((run) => {
      const id = rowIdOf(run);
      const keptRun = kept.get(id);
      kept.delete(id);
      return rowOf(run, {
        ...(keptRun && notesOf(keptRun)),
        ...notes.get(id),
      });
    })
    .reverse();
  const current = [...live, ...unlogged].sort(
    (newer, older) => older.startedAt - newer.startedAt
  );
  return [...current, ...earlier.filter((run) => kept.has(run.id))];
}

/** The notes a kept row was kept with. */
function notesOf({ className, objectPath, item, steps }: Run): RunNotes {
  return {
    ...(className !== undefined && objectPath !== undefined
      ? { target: { className, objectPath } }
      : {}),
    ...(item ? { item } : {}),
    steps,
  };
}

function isArguments(input: LogRun["input"]): input is ToolArguments {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
