import type { JsonSchema } from "@ayme-dev/core/tool-input";

import type { AgentConnection } from "../../connection";
import type { Pairing } from "../../pairing";
import type { ToolResult } from "../domain/toolResult";
import type { SaveImage } from "./callPageTool";

/** What a server tool may use. */
export type ServerToolContext = {
  connection: AgentConnection;
  /** The address and token a page pairs with. */
  pairing: Pairing;
  /** Where an image a page tool returns is saved. */
  saveImage: SaveImage;
  /** Whether the connection ever offered a tool by that name, to tell a gone tool from an unknown one. */
  wasOffered(name: string): boolean;
};

/**
 * A tool of the Ayme MCP server itself, as opposed to one the page offers.
 * It lives only in the server, so it is never published to the page's
 * WebMCP tools.
 */
export type ServerTool = {
  name: string;
  description: string;
  /** The server checks a call's input against it before `call` runs. */
  inputSchema: JsonSchema & { type: "object" };
  call(input: Record<string, unknown>): Promise<ToolResult>;
};

/** Builds a server tool from what it may use. */
export type ServerToolFactory = (context: ServerToolContext) => ServerTool;
