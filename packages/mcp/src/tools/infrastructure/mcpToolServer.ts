import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConnection } from "../../connection";
import type { ServerTool } from "../application/serverTool";
import {
  errorResult,
  notConnectedResult,
  pageToolResult,
} from "../domain/toolResult";

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
  const stopNotifying = connection.subscribe(() => {
    // Only while an agent is connected; the notification can't reach it otherwise.
    if (server.transport) void server.sendToolListChanged().catch(() => {});
  });
  const server = new (class extends Server {
    override async close() {
      stopNotifying();
      await super.close();
    }
  })({ name, version }, { capabilities: { tools: { listChanged: true } } });
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
      ...pageTools().map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: { ...inputSchema, type: "object" as const },
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input = {} } = request.params;
    const serverTool = serverTools.find((tool) => tool.name === name);
    if (serverTool) return serverTool.call(input);
    if (pageTools().some((tool) => tool.name === name))
      return pageToolResult(await connection.call(name, input));
    if (!connection.paired) return notConnectedResult();
    return errorResult(`Unknown tool "${name}".`);
  });

  return server;
}
