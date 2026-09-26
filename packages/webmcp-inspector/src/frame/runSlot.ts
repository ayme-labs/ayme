import type { ReactNode } from "react";

/**
 * What a detail view asks the run slot to run. Ticket D's run card extends
 * it; until then the slot holds the skeleton's tool form.
 */
export type RunRequest = {
  toolName: string;
  /** The Structural Ref a Ref tool runs on, e.g. from a structure node. */
  ref?: string;
};

/**
 * The run slot: detail views call it wherever something can be run, so
 * running works the same everywhere.
 */
export type RenderRun = (request: RunRequest) => ReactNode;
