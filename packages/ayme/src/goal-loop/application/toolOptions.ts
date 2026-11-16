import { requiredDescription } from "../../page-objects/domain";
import {
  listAvailablePomTools,
  listRootedToolInstances,
} from "../../page-objects/infrastructure";
import { listElementTools, NAVIGATION_TOOLS } from "../../tools/infrastructure";
import { elementToolTargets, type ReachOn } from "../../tools/application";
import type { PageStateCapture } from "../../page-state/domain";
import {
  requiredParamsOf,
  specsOfRootedTool,
  specsOfElementToolSchema,
  specsOfObjectSchema,
  specsOfParameters,
  type GoalLoopOperation,
  type ToolOption,
} from "../domain/goalLoopOperations";
import type { StartChildRun } from "../../runs/application";

// The Goal Loop's operations list, read from the runtime at each step.

/**
 * Build the flat list of tool options offered to the model each step: every
 * single-element tool, a Browser Tool or a Custom Tool (ADR-0023), every
 * Browser Tool that moves the page, and every registered POM tool. Read from
 * the runtime at the step, so the Step Decision takes it as a value. The
 * elements each single-element tool takes come from the step's `capture`,
 * which carries the refs each predicate keeps (the in-page module evaluated
 * them); reach is measured on the goal Run's page, with its Reach.
 */
export async function buildToolOptions(
  on: ReachOn,
  capture: PageStateCapture
): Promise<ToolOption[]> {
  const elementTools: GoalLoopOperation[] = await Promise.all(
    listElementTools().map(async (registered) => {
      const { tool, targetField, loopInputSchema, needsReach } = registered;
      const { matched, nodes } = await elementToolTargets(
        registered,
        on,
        capture
      );
      return {
        name: tool.name,
        description: tool.description,
        execute: (input: unknown, run: StartChildRun) => run(tool.name, input),
        requiredParams: [...(loopInputSchema.required ?? [])],
        args: specsOfElementToolSchema(loopInputSchema, targetField, {
          kind: "ref",
          nodes,
          // What it takes but a click would not reach.
          unreachable: needsReach ? matched.length : 0,
        }),
      };
    })
  );
  const navigationTools: GoalLoopOperation[] = NAVIGATION_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    execute: (input: unknown, run: StartChildRun) => run(tool.name, input),
    requiredParams: [...(tool.inputSchema.required ?? [])],
    args: specsOfObjectSchema(tool.inputSchema),
  }));
  const rootedInstances = await listRootedToolInstances();
  const pomTools: GoalLoopOperation[] = listAvailablePomTools().map((t) => {
    const roots = rootedInstances.get(t.name);
    const args = roots
      ? specsOfRootedTool(t.parameters, roots)
      : specsOfParameters(t.parameters);
    return {
      name: t.name,
      className: t.className,
      description: requiredDescription(t),
      // An action without parameters of its own still takes the empty `args`.
      execute: (input: unknown, run: StartChildRun) =>
        run(
          t.name,
          roots ? { args: {}, ...(input as Record<string, unknown>) } : input
        ),
      // A tuple is required as a whole, not slot by slot.
      requiredParams: requiredParamsOf(t.parameters, roots !== undefined),
      args,
    };
  });

  return [...elementTools, ...navigationTools, ...pomTools].map((tool) => ({
    key: tool.name,
    label: tool.description,
    tool,
  }));
}
