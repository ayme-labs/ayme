import type { JsonSchema } from "@ayme-dev/core/tool-input";

import type { AgentConnection } from "../../connection";
import type { Pairing } from "../../pairing";
import type { FailedPageObjects, ToolResult } from "../domain/toolResult";

/** What a server tool may use. */
export type ServerToolContext = {
  connection: AgentConnection;
  /** The address and token a page pairs with. */
  pairing: Pairing;
  /** The external Inspector this server serves. */
  inspector: {
    /** Its URL. */
    url: string;
    /** Whether the optional `@ayme-dev/inspector` package that holds it is installed. */
    installed(): Promise<boolean>;
    /** The page an Agent App shows in its chat, which connects to `socketOrigin`. */
    appPage(): Promise<string>;
    /** The origin of the socket the Agent App's page connects to. */
    socketOrigin: string;
  };
  /**
   * The init script that loads the Page Objects this server serves, when it
   * serves any (see `served-page-objects`).
   */
  initScript?: string;
  /**
   * Why the Page Objects this server serves did not build, while no build
   * of them has succeeded; `undefined` once one has, or when it serves none.
   */
  failedPageObjects(): Promise<FailedPageObjects | undefined>;
  /** Whether the connection ever offered a tool by that name, to tell a gone tool from an unknown one. */
  wasOffered(name: string): boolean;
};

/**
 * A tool of the ayme MCP server itself, as opposed to one the page offers.
 * It lives only in the server, so it is never published to the page's
 * WebMCP tools.
 */
export type ServerTool = {
  name: string;
  description: string;
  /** The server checks a call's input against it before `call` runs. */
  inputSchema: JsonSchema & { type: "object" };
  call(input: Record<string, unknown>): Promise<ToolResult>;
  /** The page an Agent App that shows MCP Apps shows for the tool, if any. */
  app?: AppPage;
};

/** A page an Agent App shows in its chat, as an MCP App. */
export type AppPage = {
  /** Its `ui://` address. */
  uri: string;
  /** Its name in the server's resources. */
  name: string;
  /** The origins it connects to, which the Agent App lets it reach. */
  connectDomains: string[];
  /** Its HTML document, read each time the Agent App reads the page. */
  html(): Promise<string>;
};

/** Builds a server tool from what it may use. */
export type ServerToolFactory = (context: ServerToolContext) => ServerTool;
