import {
  callTool,
  connectTool,
  listToolsTool,
  type ServerToolFactory,
} from "../tools";

/** The server's own tools, in the order agents list them. */
export const serverTools: readonly ServerToolFactory[] = [
  connectTool,
  listToolsTool,
  callTool,
];
