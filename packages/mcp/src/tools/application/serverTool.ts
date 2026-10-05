import type { AgentConnection } from "../../connection";
import type { Pairing } from "../../pairing";
import type { ToolResult } from "../domain/toolResult";

/** What a server tool may use. */
export type ServerToolContext = {
  connection: AgentConnection;
  /** The address and token a page pairs with. */
  pairing: Pairing;
};

/**
 * A tool of the Ayme MCP server itself, as opposed to one the page offers.
 * It lives only in the server, so it is never published to the page's
 * WebMCP tools.
 */
export type ServerTool = {
  name: string;
  description: string;
  inputSchema: { type: "object" } & Record<string, unknown>;
  call(input: Record<string, unknown>): Promise<ToolResult>;
};

/** Builds a server tool from what it may use. */
export type ServerToolFactory = (context: ServerToolContext) => ServerTool;
