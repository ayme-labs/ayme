import { toolInputViolations } from "@ayme-dev/ayme/internal";

import type { ToolArguments } from "../../runs";
import type { RunnableTool } from "../domain/runnableTools";

/**
 * Every way a tool's arguments break its schema, as the runtime checks them
 * when it's called, e.g. `values.zip: must be a string or a number`.
 */
export function argumentViolationsOf(tool: RunnableTool) {
  return (args: ToolArguments) =>
    toolInputViolations(tool.argumentsSchema, args);
}
