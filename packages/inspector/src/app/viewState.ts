import { type LensId, pageSelection, type Selection } from "../navigation";

/** The key of the Inspector's view state in the tab's storage. */
export const viewStateKey = "ayme-inspector:view";

/**
 * Where the person was in the Inspector: the lens, the selection and the
 * Runs region. It is kept for the tab, so a reload comes back to it.
 */
export type ViewState = {
  lens: LensId;
  selection: Selection;
  runs: {
    open: boolean;
    /** Whether Runs lists every run, not only the selection's. */
    all: boolean;
  };
};

export const defaultViewState: ViewState = {
  lens: "model",
  selection: pageSelection,
  runs: { open: true, all: false },
};

const lenses: readonly LensId[] = ["model", "structure", "tools"];

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
