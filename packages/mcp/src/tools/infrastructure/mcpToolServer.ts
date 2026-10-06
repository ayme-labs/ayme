import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConnection } from "../../connection";
import { callPageTool } from "../application/callPageTool";
import type { ServerTool } from "../application/serverTool";
import { toolChangeNote, type ToolState } from "../domain/toolChangeNote";
import {
  errorResult,
  mcpPageTool,
  type ToolResult,
} from "../domain/toolResult";

/**
 * The MCP server an agent talks to: the server's own tools, then the tools
 * of the paired page and App Processes under the names they give them (see
 * `AgentConnection` for which of two same-named tools the agent sees). A
 * tool that shares a server tool's name is left out. While nothing is paired, any other name
 * answers that no page is connected, since it may be a page tool the agent
 * listed before. The agent hears `notifications/tools/list_changed` whenever
 * a page or App Process pairs, leaves or reports new tools, such as when a
 * Page Object appears or goes. One server serves one agent, so every tool
 * result also carries, as a text item after the tool's own, a note of the
 * tools that appeared, disappeared or were hidden since the previous tool
 * call; before the first call the agent has seen no tools.
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

  const run = (name: string, input: Record<string, unknown>) => {
    const serverTool = serverTools.find((tool) => tool.name === name);
    if (serverTool) return serverTool.call(input);
    return callPageTool(connection, name, input, () =>
      errorResult(`Unknown tool "${name}".`)
    );
  };

  // The tools as of the previous result, taken once that result is ready.
  let seen: ToolState = { names: [], hidden: [] };
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<ToolResult> => {
      const { name, arguments: input = {} } = request.params;
      const result = await run(name, input);
      const current: ToolState = {
        names: pageTools().map((tool) => tool.name),
        hidden: connection.hidden,
      };
      const note = toolChangeNote(seen, current);
      seen = current;
      if (!note) return result;
      return {
        ...result,
        content: [...result.content, { type: "text", text: note }],
      };
    }
  );

  return server;
}
