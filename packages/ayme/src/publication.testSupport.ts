/**
 * Test support: the started session's tools as an agent calls them through
 * WebMCP, and a Goal Loop decision function that runs given operations.
 */
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import type { DecisionResponse } from "./decisionTypes";
import { RuntimeStateError } from "./errors";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import { listWebMcpTools } from "./publishedTools";
import { callers } from "./run";
import { getStartedAyme } from "./runtime";

/**
 * The started session's tools as WebMCP publishes them to an agent, without
 * a driver. A call is a `webmcp` Run, as an agent's call through
 * `@ayme-dev/webmcp` is, and fails as that Run does: the package's own tests
 * check the `isError` result an agent gets for it.
 */
export function agentTools() {
  const ayme = getStartedAyme();
  if (!ayme) throw new Error("Start a session before calling its tools.");
  /** The names of the tools WebMCP publishes now, in publication order. */
  const names = () => listWebMcpTools().map(({ name }) => name);
  return {
    names,
    /** Call a tool as the agent. */
    call: async (name: string, input: unknown): Promise<unknown> => {
      if (!names().includes(name))
        throw new RuntimeStateError(`Tool ${name} is not published.`);
      return ayme.tools.run(name, input as never, { by: callers.webmcp });
    },
  };
}

/** The Structural Ref of the "Save changes" button in the agent's snapshot. */
export async function saveButtonRef() {
  const { structure } = (await agentTools().call("snapshot", {})) as {
    structure: string;
  };
  const ref = structure.match(/(e\d+) button "Save changes"/)?.[1];
  if (!ref) throw new Error("Expected a Structural Ref for Save changes.");
  return AriaRefSchema.parse(ref);
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
