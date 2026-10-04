import type { RunStep } from "./runSteps";
import type { CollectionItem, Run } from "./useRuns";

// Hand-written runs for tests. Each builder fills what a test doesn't care
// about and derives what follows from its inputs, so a test states only
// what it is about.

// Clear of the small ids tests set when an assertion names a run.
let nextRunId = 1000;

/**
 * A settled run of ListPage.addItem, with a fresh id. A run on an item is on
 * that item's path, and a Browser Tool's run (a name without a dot, e.g.
 * "fill") is on no Page Object.
 */
export function aRun(fields: Partial<Run> = {}): Run {
  const toolName = fields.toolName ?? "ListPage.addItem";
  const [owner, ...rest] = toolName.split(".");
  const target = rest.length
    ? { className: owner!, objectPath: fields.item?.path ?? owner! }
    : {};
  const status = fields.status ?? "succeeded";
  return {
    id: nextRunId++,
    toolName,
    ...target,
    arguments: {},
    status,
    startedAt: 0,
    ...(status === "running" ? {} : { durationMs: 5 }),
    steps: [],
    ...fields,
  };
}

/** A click on a button. */
export function aStep(fields: Partial<RunStep> = {}): RunStep {
  return { operation: "click", locator: "getByRole('button')", ...fields };
}

/**
 * An item of a collection, at its path from the page, e.g.
 * "ListPage.items[1]": its name and its path below the page follow.
 */
export function anItem(
  path: string,
  fields: Pick<CollectionItem, "ref" | "label">
): CollectionItem {
  return {
    path,
    name: path.slice(path.lastIndexOf("[")),
    pathBelowPage: path.slice(path.indexOf(".") + 1),
    ...fields,
  };
}
