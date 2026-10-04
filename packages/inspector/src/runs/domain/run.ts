import type { JsonValue } from "@ayme-dev/ayme";

/** A locator operation the Inspector's instrumentation records. */
export type TraceEntry = {
  operation:
    "click" | "fill" | "press" | "pressSequentially" | "waitFor" | "expect";
  locator: string;
  value?: string;
  state?: string;
};

/** A step of a run: a locator operation from the Inspector's own trace. */
export type RunStep = TraceEntry & {
  /**
   * The Page Object member it acted on, e.g. "ListPage.addItemButton",
   * when its element was still on the page as the run ended.
   */
  member?: string;
};

export type ToolArguments = Record<string, JsonValue>;

/** A Page Object in a collection, e.g. ListPage.items[1], with its ref. */
export type CollectionItem = {
  /** Its path from the page, e.g. "ListPage.items[1]". */
  path: string;
  /** Its name in its collection, e.g. "[1]". */
  name: string;
  /** Its path below its page, e.g. "items[1]". */
  pathBelowPage: string;
  /** The Structural Ref of its root, which a collection action takes. */
  ref: string;
  /** What it shows, e.g. "Milk". */
  label: string;
};

/** A run made from the panel: one tool call, with the steps it performed. */
export type Run = {
  id: number;
  toolName: string;
  /** The Page Object Model whose action it ran. */
  className?: string;
  /** The Page Object it ran on, e.g. "ListPage" or "ListPage.items[1]". */
  objectPath?: string;
  /** The collection item it ran on. */
  item?: CollectionItem;
  arguments: ToolArguments;
  status: "running" | "succeeded" | "failed";
  /**
   * What the tool returned, as formatted JSON captured as it returned, so a
   * later change to the returned value doesn't change it. Absent when it
   * returned `undefined`.
   */
  result?: string;
  error?: string;
  /** When it started, in epoch milliseconds. */
  startedAt: number;
  durationMs?: number;
  /** The locator operations it performed, from the Inspector's own trace. */
  steps: readonly RunStep[];
};

/** A request to bring one run into view. A new `at` repeats it. */
export type RunFocus = { runId: number; at: number };
