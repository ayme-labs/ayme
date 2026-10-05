/**
 * Test support: the started session's published tools as the calling agent
 * calls them, and a Goal Loop decision function that runs given operations.
 */
import type { DecisionResponse } from "./decisionTypes";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import { synchronizeWebMcpTools } from "./webMcp";

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

/** Publish the started session's tools, as the calling agent sees them. */
export async function publishTools() {
  const published = new Map<string, PublishedTool>();
  const { dispose } = await synchronizeWebMcpTools({
    async registerTool(tool: PublishedTool) {
      published.set(tool.name, tool);
    },
  });
  return {
    /** Call a published tool as the calling agent. */
    call(name: string, input: unknown) {
      const tool = published.get(name);
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      return tool.execute(input);
    },
    dispose,
  };
}

/**
 * A decision function that runs the listed operations, one per step, the last
 * one again once the list runs out, and never judges the goal met.
 */
export function operations(steps: string[]): GoalLoopDecisionFunction {
  let step = 0;
  return async (): Promise<DecisionResponse> => ({
    model: "typesafe/jev-1.13",
    answers: {
      operation: {
        type: "choice",
        choice: steps[Math.min(step++, steps.length - 1)]!,
        confidence: 1,
      },
      goal_met: { type: "noul", noul: 0.1 },
    },
  });
}
