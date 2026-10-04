export { connectTool } from "./application/connectTool";
export type {
  ServerTool,
  ServerToolContext,
  ServerToolFactory,
} from "./application/serverTool";
export type { ToolResult } from "./domain/toolResult";
export { createMcpToolServer } from "./infrastructure/mcpToolServer";
export {
  answerToolCalls,
  publishPageTools,
} from "./infrastructure/pageToolBehaviours";
