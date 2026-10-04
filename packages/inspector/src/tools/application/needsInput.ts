import type { RunnableTool } from "../domain/runnableTools";

/**
 * Whether Run must open the form before it runs the tool: the tool has a
 * required argument the view doesn't give, or it's a collection action whose
 * item isn't given.
 */
export function needsInput(
  tool: Pick<RunnableTool, "argumentsSchema" | "collection">,
  {
    itemGiven,
    givenArguments = [],
  }: {
    itemGiven: boolean;
    /** Arguments the view fills in, e.g. a structure node's `ref`. */
    givenArguments?: readonly string[];
  }
) {
  return (
    (tool.collection !== undefined && !itemGiven) ||
    (tool.argumentsSchema.required ?? []).some(
      (name) => !givenArguments.includes(name)
    )
  );
}
