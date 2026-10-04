import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConnection } from "../../connection";
import { callPageTool } from "../application/callPageTool";
import type { ServerTool } from "../application/serverTool";
import { errorResult, mcpPageTool } from "../domain/toolResult";

/**
 * The MCP server an agent talks to: the server's own tools, then the paired
 * page's tools under the names the page gives them. A page tool that shares
 * a server tool's name is left out. While no page is paired, any other name
 * answers that no page is connected, since it may be a page tool the agent
 * listed before. The agent hears `notifications/tools/list_changed` whenever
 * a page pairs, leaves or reports new tools.
 */
export function createMcpToolServer({
  name,
  version,
  serverTools,
  connection,
}: {
  name: string;
  version: string;
  serverTools: readonly ServerTool[];
  connection: AgentConnection;
}): Server {
  const server = new Server(
    { name, version },
    { capabilities: { tools: { listChanged: true } } }
  );
  // The connection lives as long as the server, so this never unsubscribes.
  connection.subscribe(() => {
    // Only while an agent is connected; the notification can't reach it otherwise.
    if (server.transport) void server.sendToolListChanged().catch(() => {});
  });
  const ownNames = new Set(serverTools.map((tool) => tool.name));
  const pageTools = () =>
    connection.tools.filter((tool) => !ownNames.has(tool.name));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...serverTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
      ...pageTools().map(mcpPageTool),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input = {} } = request.params;
    const serverTool = serverTools.find((tool) => tool.name === name);
    if (serverTool) return serverTool.call(input);
    return callPageTool(connection, name, input, () =>
      errorResult(`Unknown tool "${name}".`)
    );
  });

  return server;
}
