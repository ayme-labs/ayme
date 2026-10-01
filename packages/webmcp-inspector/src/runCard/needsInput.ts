import type { RunnableTool } from "../adapter/runnableTools";

/**
 * Whether Run must open the form before it runs the tool: the tool has a
 * required argument, or it's a collection action whose item isn't given.
 */
export function needsInput(
  tool: Pick<RunnableTool, "argumentsSchema" | "collection">,
  { itemGiven }: { itemGiven: boolean }
) {
  return (
    (tool.collection !== undefined && !itemGiven) ||
    (tool.argumentsSchema.required?.length ?? 0) > 0
  );
}
