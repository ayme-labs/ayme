import type { CollectionItem, Run, RunStep, ToolArguments } from "./run";

/** The key of the run history in the tab's storage. */
export const runsKey = "ayme-inspector:runs";

/** How many of the newest rows, of every Caller, are kept for the tab. */
export const keptRuns = 50;

/** What a run still running when the page reloaded ends with. */
export const reloadedError = "The page reloaded before the run returned.";

/** The run history as it is kept: the newest runs only. */
export function encodeRuns(runs: readonly Run[]): readonly Run[] {
  return runs.slice(0, keptRuns);
}

/**
 * The run history in a stored value, newest first, from an earlier document.
 * A malformed run is left out, and one that was still running failed with the
 * reload, after an unknown time.
 */
export function decodeRuns(stored: unknown): Run[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((value) => {
    const run = decodeRun(value);
    return run ? [run] : [];
  });
}

function decodeRun(stored: unknown): Run | undefined {
  if (
    !isRecord(stored) ||
    typeof stored.id !== "string" ||
    typeof stored.toolName !== "string" ||
    typeof stored.by !== "string" ||
    stored.by === "" ||
    typeof stored.startedAt !== "number" ||
    !isRecord(stored.arguments) ||
    !Array.isArray(stored.steps) ||
    !stored.steps.every(isStep)
  )
    return undefined;
  const status = stored.status;
  if (status !== "running" && status !== "succeeded" && status !== "failed")
    return undefined;

  return {
    id: stored.id,
    toolName: stored.toolName,
    by: stored.by,
    ...text("className", stored.className),
    ...text("objectPath", stored.objectPath),
    ...(isItem(stored.item) ? { item: stored.item } : {}),
    arguments: stored.arguments as ToolArguments,
    startedAt: stored.startedAt,
    steps: stored.steps,
    earlierDocument: true,
    ...(status === "running"
      ? { status: "failed", error: reloadedError }
      : {
          status,
          ...text("result", stored.result),
          ...text("error", stored.error),
          ...(typeof stored.durationMs === "number"
            ? { durationMs: stored.durationMs }
            : {}),
        }),
  };
}

function isStep(value: unknown): value is RunStep {
  return (
    isRecord(value) &&
    typeof value.operation === "string" &&
    ["locator", "value", "state", "member"].every(
      (key) => value[key] === undefined || typeof value[key] === "string"
    )
  );
}

function isItem(value: unknown): value is CollectionItem {
  return (
    isRecord(value) &&
    ["path", "name", "pathBelowPage", "ref", "label"].every(
      (key) => typeof value[key] === "string"
    )
  );
}

function text<K extends string>(key: K, value: unknown) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<K, string>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
