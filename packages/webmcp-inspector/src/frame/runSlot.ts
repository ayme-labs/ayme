import type { ReactNode } from "react";

/** What a detail view asks the run slot to run. */
export type RunRequest = {
  toolName: string;
  /**
   * For a collection action, the item it runs on, by path, e.g.
   * "ListPage.items[1]". Without it, the run card lets the person pick one.
   */
  item?: string;
  /**
   * Whether the run card shows its head: the action's name, signature,
   * description and Run. A tool's own view leaves it out: its form is open
   * and Run sits at the foot. Defaults to true.
   */
  head?: boolean;
};

/**
 * The run slot: detail views call it wherever something can be run, so
 * running works the same everywhere. It renders the run card.
 */
export type RenderRun = (request: RunRequest) => ReactNode;
