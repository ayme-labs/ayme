import type { Caller, Interaction, JsonValue } from "@ayme-dev/ayme";

/** An Interaction of a Run, from the Run log, as Runs shows it. */
export type RunInteraction = Interaction & {
  /**
   * The Page Object member it acted on, e.g. "ListPage.addItemButton",
   * when its element was on the page as the Run ended.
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

/**
 * A Run as Runs shows it, at any depth: one tool call from the runtime's Run
 * log, with the Interactions it performed itself and the Runs it started.
 */
export type ChildRun = {
  /** Unique across the documents the tab has shown. */
  id: string;
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
  /** The Interactions it performed itself, in order: not its children's. */
  interactions: readonly RunInteraction[];
  /** The Runs it started, in the order it started them. */
  children: readonly ChildRun[];
};

/** A top-level Run as Runs shows it: one a Caller started. */
export type Run = ChildRun & {
  /** Its Caller: who started it. */
  by: Caller;
  /**
   * Made before the page last loaded, so the refs it names (its item's, its
   * `ref` or `target` argument) named elements of that document, not this
   * one.
   */
  earlierDocument?: true;
};

/** A request to bring one run into view. A new `at` repeats it. */
export type RunFocus = { runId: string; at: number };
