import type { Run as LogRun, callers } from "@ayme-dev/ayme";

import { runImageOf } from "./runImage";
import type {
  ChildRun,
  CollectionItem,
  Run,
  RunInteraction,
  ToolArguments,
} from "./run";

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
 * was on when the panel first saw it, the item a run made from the panel
 * ran on, the member each of its Interactions acted on, by place, and the
 * file `ayme mcp` saved the image an agent's Run returned to.
 */
export type RunNotes = {
  target?: RunTarget;
  item?: CollectionItem;
  members?: readonly (string | undefined)[];
  savedTo?: string;
};

/**
 * A Run's row id: its log id with its start time, so it stays unique across
 * documents, whose logs each number their Runs from the start.
 */
export function rowIdOf(run: Pick<LogRun, "id" | "startedAt">): string {
  return `${run.id}@${run.startedAt}`;
}

/** A top-level Run: one a Caller started, not a tool. */
type TopLevelRun = Extract<LogRun, { by: unknown }>;

/** The panel's notes on a Run, by its row id. */
type Notes = (rowId: string) => RunNotes;

/** A Run from the log as Runs shows it, with the Runs it started. */
function nodeOf(
  run: LogRun,
  notesOf: Notes,
  childrenOf: ReadonlyMap<string, readonly LogRun[]>
): ChildRun {
  const id = rowIdOf(run);
  const notes = notesOf(id);
  // An image shows as itself, never as its base64 JSON.
  const image = runImageOf(run.result, notes.savedTo);
  return {
    id,
    toolName: run.tool,
    ...notes.target,
    ...(notes.item ? { item: notes.item, objectPath: notes.item.path } : {}),
    arguments: isArguments(run.input) ? run.input : {},
    status: run.status,
    ...(image
      ? { image }
      : run.result === undefined
        ? {}
        : { result: JSON.stringify(run.result, null, 2) }),
    ...(run.error === undefined ? {} : { error: run.error }),
    startedAt: run.startedAt,
    ...(run.durationMs === undefined
      ? {}
      : { durationMs: Math.round(run.durationMs) }),
    interactions: run.interactions.map((interaction, index) => {
      const member = notes.members?.[index];
      return member === undefined
        ? { ...interaction }
        : { ...interaction, member };
    }),
    children: (childrenOf.get(run.id) ?? []).map((child) =>
      nodeOf(child, notesOf, childrenOf)
    ),
  };
}

/**
 * The rows Runs shows, newest first: the log's top-level Runs that started
 * after the panel was last cleared, each with the Runs it started nested
 * under it, then the rows kept from earlier pages. A kept row that is still in the log, as
 * when the panel mounts again on the same page, shows as the log's, with
 * the notes it was kept with.
 */
export function shownRuns({
  log,
  notes,
  earlier,
  clearedAt,
}: {
  /** The page's Run log, oldest first. */
  log: readonly LogRun[];
  notes: ReadonlyMap<string, RunNotes>;
  /** The rows kept from before the panel last mounted, newest first. */
  earlier: readonly Run[];
  /** When the panel was last cleared, in epoch milliseconds. */
  clearedAt: number;
}): Run[] {
  const kept = new Map(earlier.map((run) => [run.id, run]));
  const keptNotes = new Map<string, RunNotes>();
  const childrenOf = new Map<string, LogRun[]>();
  for (const run of log)
    if (run.parent !== undefined)
      childrenOf.set(run.parent, [...(childrenOf.get(run.parent) ?? []), run]);
  const notesOf: Notes = (rowId) => ({
    ...keptNotes.get(rowId),
    ...notes.get(rowId),
  });
  const live = log
    .filter(
      (run): run is TopLevelRun =>
        run.parent === undefined && run.startedAt > clearedAt
    )
    .map((run): Run => {
      const keptRun = kept.get(rowIdOf(run));
      if (keptRun) {
        kept.delete(keptRun.id);
        noteTree(keptRun, keptNotes);
      }
      return { ...nodeOf(run, notesOf, childrenOf), by: run.by };
    })
    .reverse();
  return [...live, ...earlier.filter((run) => kept.has(run.id))];
}

/** The notes a kept row and the rows nested in it were kept with. */
function noteTree(
  { id, className, objectPath, item, image, interactions, children }: ChildRun,
  notes: Map<string, RunNotes>
) {
  notes.set(id, {
    ...(className !== undefined && objectPath !== undefined
      ? { target: { className, objectPath } }
      : {}),
    ...(item ? { item } : {}),
    members: interactions.map(({ member }: RunInteraction) => member),
    ...(image?.savedTo === undefined ? {} : { savedTo: image.savedTo }),
  });
  for (const child of children) noteTree(child, notes);
}

function isArguments(input: LogRun["input"]): input is ToolArguments {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
