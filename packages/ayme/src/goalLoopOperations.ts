import { listElementTools, NAVIGATION_TOOLS } from "./browserTools";
import {
  requiredParamsOf,
  specsOfCollectionTool,
  specsOfElementToolSchema,
  specsOfObjectSchema,
  specsOfParameters,
  type GoalLoopOperation,
  type ToolOption,
} from "./goalLoopQuestions";
import { listCollectionToolItems, listAvailablePomTools } from "./registry";
import type { StartChildRun } from "./run";

/**
 * Build the flat list of tool options offered to the model each step: every
 * single-element tool, a Browser Tool or a Custom Tool (ADR-0023), every
 * Browser Tool that moves the page, and every registered POM tool. Read from
 * the runtime at the step, so the Step Decision takes it as a value.
 */
export function buildToolOptions(): ToolOption[] {
  const elementTools: GoalLoopOperation[] = listElementTools().map(
    ({ tool, targetField, loopInputSchema, filter, matches }) => ({
      name: tool.name,
      description: tool.description,
      execute: (input: unknown, run: StartChildRun) => run(tool.name, input),
      requiredParams: [...(loopInputSchema.required ?? [])],
      args: specsOfElementToolSchema(
        loopInputSchema,
        targetField,
        matches ? { kind: "ref", filter, matches } : { kind: "ref", filter }
      ),
    })
  );
  const navigationTools: GoalLoopOperation[] = NAVIGATION_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    execute: (input: unknown, run: StartChildRun) => run(tool.name, input),
    requiredParams: [...(tool.inputSchema.required ?? [])],
    args: specsOfObjectSchema(tool.inputSchema),
  }));
  const collectionRoots = listCollectionToolItems();
  const pomTools: GoalLoopOperation[] = listAvailablePomTools().map((t) => {
    const roots = collectionRoots.get(t.name);
    const args = roots
      ? specsOfCollectionTool(t.parameters, roots)
      : specsOfParameters(t.parameters);
    return {
      name: t.name,
      description: t.description,
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
