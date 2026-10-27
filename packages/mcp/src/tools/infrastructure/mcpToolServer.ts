import {
  toolInputViolations,
  violationSentences,
} from "@ayme-dev/core/tool-input";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { callPageTool } from "../application/callPageTool";
import type {
  ServerTool,
  ServerToolContext,
  ServerToolFactory,
} from "../application/serverTool";
import { AgentToolView } from "../domain/agentToolView";
import {
  errorResult,
  goneToolResult,
  mcpPageTool,
  type ToolResult,
} from "../domain/toolResult";

/**
 * The MCP server an agent talks to: the server's own tools, then the tools
 * of the paired page and App Processes under the names they give them (see
 * `AgentConnection` for which of two same-named tools the agent sees), as
 * the server's `AgentToolView` lists them. While nothing is paired, any
 * other name answers that no page is connected, since it may be a page tool
 * the agent listed before. One server serves one agent, so that view says
 * when the agent hears `notifications/tools/list_changed`, and every tool
 * result carries its tool change note, if any, as a text item after the
 * tool's own. A server tool's input is checked against its input schema
 * before the tool runs, with arguments left out taken as `{}`; a page
 * tool's input is the page's to check.
 */
export function createMcpToolServer({
  name,
  version,
  serverTools: serverToolFactories,
  context,
}: {
  name: string;
  version: string;
  serverTools: readonly ServerToolFactory[];
  /** What the server tools may use, besides what the agent was shown. */
  context: Omit<ServerToolContext, "wasOffered">;
}): Server {
  const { connection, saveImage } = context;
  const server = new Server(
    { name, version },
    { capabilities: { tools: { listChanged: true } } }
  );
  // Asked only once a tool runs, by when `view` exists.
  const wasOffered = (name: string): boolean => view.wasOffered(name);
  const serverTools: readonly ServerTool[] = serverToolFactories.map((tool) =>
    tool({ ...context, wasOffered })
  );
  const view = new AgentToolView(
    serverTools.map((tool) => tool.name),
    connection.tools
  );

  // The connection lives as long as the server, so this never unsubscribes.
  connection.subscribe(() => {
    if (!view.toolsChanged(connection.tools)) return;
    // Only while an agent is connected; the notification can't reach it otherwise.
    if (server.transport) void server.sendToolListChanged().catch(() => {});
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...serverTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
      ...view.listRead(connection.tools).map(mcpPageTool),
    ],
  }));

  const run = (name: string, input: Record<string, unknown>) => {
    const serverTool = serverTools.find((tool) => tool.name === name);
    if (serverTool) {
      const violations = toolInputViolations(serverTool.inputSchema, input);
      if (violations.length > 0)
        return errorResult(`ToolInputError: ${violationSentences(violations)}`);
      return serverTool.call(input);
    }
    return callPageTool(
      connection,
      name,
      input,
      () =>
        wasOffered(name)
          ? goneToolResult(name)
          : errorResult(`Unknown tool "${name}".`),
      saveImage
    );
  };

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<ToolResult> => {
      const { name, arguments: input = {} } = request.params;
      const result = await run(name, input);
      // Taken once the result is ready.
      const note = view.resultReturned({
        tools: connection.tools,
        hidden: connection.hidden,
      });
      if (!note) return result;
      return {
        ...result,
        content: [...result.content, { type: "text", text: note }],
      };
    }
  );

  return server;
}
