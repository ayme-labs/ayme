import {
  agentDescription,
  listAvailablePomTools,
  listRootedToolInstances,
} from "../../page-objects";
import { listElementTools, NAVIGATION_TOOLS } from "../../tools";
import {
  requiredParamsOf,
  specsOfRootedTool,
  specsOfElementToolSchema,
  specsOfObjectSchema,
  specsOfParameters,
  type GoalLoopOperation,
  type ToolOption,
} from "../domain/goalLoopOperations";
import type { Page } from "@playwright/test";
import type { StartChildRun } from "../../runs";

// The Goal Loop's operations list, read from the runtime at each step.

/**
 * Build the flat list of tool options offered to the model each step: every
 * single-element tool, a Browser Tool or a Custom Tool (ADR-0023), every
 * Browser Tool that moves the page, and every registered POM tool. Read from
 * the runtime at the step, so the Step Decision takes it as a value. Reach
 * is measured on `page`, the goal Run's.
 */
export function buildToolOptions(page: Page): ToolOption[] {
  const elementTools: GoalLoopOperation[] = listElementTools().map(
    ({ tool, targetField, loopInputSchema, filter, matches }) => {
      const offered = (element: Element) => filter(element, page);
      return {
        name: tool.name,
        description: tool.description,
        execute: (input: unknown, run: StartChildRun) => run(tool.name, input),
        requiredParams: [...(loopInputSchema.required ?? [])],
        args: specsOfElementToolSchema(
          loopInputSchema,
          targetField,
          matches
            ? { kind: "ref", filter: offered, matches }
            : { kind: "ref", filter: offered }
        ),
      };
    }
  );
  const navigationTools: GoalLoopOperation[] = NAVIGATION_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    execute: (input: unknown, run: StartChildRun) => run(tool.name, input),
    requiredParams: [...(tool.inputSchema.required ?? [])],
    args: specsOfObjectSchema(tool.inputSchema),
  }));
  const rootedInstances = listRootedToolInstances();
  const pomTools: GoalLoopOperation[] = listAvailablePomTools().map((t) => {
    const roots = rootedInstances.get(t.name);
    const args = roots
      ? specsOfRootedTool(t.parameters, roots)
      : specsOfParameters(t.parameters);
    return {
      name: t.name,
      className: t.className,
      description: agentDescription(t, { required: true }),
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
