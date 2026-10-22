import { type LensId, pageSelection, type Selection } from "../navigation";
import {
  type ObjectTree,
  type PageObjectNode,
  revealSelection,
} from "../page-model";

/** The key of the Inspector's view state in the tab's storage. */
export const viewStateKey = "ayme-inspector:view";

/**
 * Where the person was in the Inspector: the lens, the selection, the Runs
 * region and how the Model tree is opened up. It is kept for the tab, so a reload comes back to it.
 */
export type ViewState = {
  lens: LensId;
  selection: Selection;
  runs: {
    open: boolean;
    /** Whether Runs lists every run, not only the selection's. */
    all: boolean;
  };
  objectTree: ObjectTree;
};

export const defaultViewState: ViewState = {
  lens: "model",
  selection: pageSelection,
  runs: { open: true, all: false },
  objectTree: { open: {} },
};

const lenses: readonly LensId[] = ["model", "structure", "tools"];

/**
 * The view state with a new selection. The objects the Model tree opened
 * around the old selection stay open; it has not opened those around the
 * new one yet, even when it was not showing as it changed.
 */
export function withSelection(
  current: ViewState,
  selection: Selection,
  objects: readonly PageObjectNode[]
): ViewState {
  const { selection: old, objectTree } = current;
  const oldPath = old.kind === "object" ? old.path : undefined;
  return {
    ...current,
    selection,
    objectTree: { open: revealSelection(objects, objectTree, oldPath).open },
  };
}

/**
 * The view state in a stored value. Each value that is missing or malformed
 * falls back to its default.
 */
export function decodeViewState(stored: unknown): ViewState {
  if (!isRecord(stored)) return defaultViewState;
  const runs = isRecord(stored.runs) ? stored.runs : {};
  return {
    lens: lenses.find((lens) => lens === stored.lens) ?? defaultViewState.lens,
    selection: decodeSelection(stored.selection),
    runs: {
      open:
        typeof runs.open === "boolean" ? runs.open : defaultViewState.runs.open,
      all: typeof runs.all === "boolean" ? runs.all : defaultViewState.runs.all,
    },
    objectTree: decodeObjectTree(stored.objectTree),
  };
}

/** The stored object tree: each path with a true or false. */
function decodeObjectTree(stored: unknown): ObjectTree {
  if (!isRecord(stored)) return defaultViewState.objectTree;
  const open = isRecord(stored.open) ? stored.open : {};
  return {
    open: Object.fromEntries(
      Object.entries(open).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
      )
    ),
    ...(isText(stored.revealed) ? { revealed: stored.revealed } : {}),
  };
}

/**
 * A stored selection. A structure node's ref is renumbered with every look
 * at the page, so after a reload it could name another element: it goes
 * back to the page instead.
 */
function decodeSelection(stored: unknown): Selection {
  if (!isRecord(stored)) return pageSelection;
  const { kind } = stored;
  if ((kind === "object" || kind === "member") && isText(stored.path))
    return { kind, path: stored.path };
  if (kind === "model" && isText(stored.className))
    return { kind, className: stored.className };
  if (kind === "tool" && isText(stored.name))
    return { kind, name: stored.name };
  return pageSelection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
