// The agent's calls through `ayme mcp` whose result is an image, such as a
// screenshot, which the page client reports for the Inspector's Runs.
import type { ImageResult } from "./toolTypes";

/** An agent's call whose result is an image. */
export type AgentImageRun = {
  name: string;
  input: unknown;
  result: ImageResult;
  /** The file `ayme mcp` saves the image to, when it named its folder. */
  savedTo: string | undefined;
  /** When the call started, in epoch milliseconds. */
  startedAt: number;
  durationMs: number;
};

const listeners = new Set<(run: AgentImageRun) => void>();

/** Package-internal: the page client reports an agent's image call. */
export function recordAgentImageRun(run: AgentImageRun) {
  for (const listener of listeners) listener(run);
}

/** Calls `listener` with each agent's image call from now on; returns what stops it. */
export function subscribeToAgentImageRuns(
  listener: (run: AgentImageRun) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
