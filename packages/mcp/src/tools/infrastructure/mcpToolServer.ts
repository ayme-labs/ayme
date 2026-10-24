import {
  toolInputViolations,
  violationSentences,
} from "@ayme-dev/core/tool-input";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConnection } from "../../connection";
import { callPageTool, type SaveImage } from "../application/callPageTool";
import { rememberOfferedNames } from "../application/offeredNames";
import type { ServerTool } from "../application/serverTool";
import { toolChangeNote, type ToolState } from "../domain/toolChangeNote";
import {
  errorResult,
  goneToolResult,
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
 * that list changes, such as when a Page Object appears or goes, and not
 * when a tool merely becomes available or unavailable: the list has no
 * field for that, and a cached list would churn (ADR-0035). One server
 * serves one agent, so every tool result also carries, as a text item after
 * the tool's own, a note of the tools that appeared, disappeared, became
 * available or unavailable or were hidden since the previous tool call or,
 * when later, the agent's last read of the tool list; an agent that has
 * done neither has seen no tools. The list says nothing of availability,
 * so a tool it first served counts as available. A server tool's input
 * is checked against its input schema before the tool runs, with arguments
 * left out taken as `{}`; a page tool's input is the page's to check.
 */
export function createMcpToolServer({
  name,
  version,
  serverTools,
  connection,
  saveImage,
}: {
  name: string;
  version: string;
  serverTools: readonly ServerTool[];
  connection: AgentConnection;
  /** Where an image a page tool returns is saved. */
  saveImage: SaveImage;
}): Server {
  const server = new Server(
    { name, version },
    { capabilities: { tools: { listChanged: true } } }
  );
  const ownNames = new Set(serverTools.map((tool) => tool.name));
  const pageTools = () =>
    connection.tools.filter((tool) => !ownNames.has(tool.name));
  const listed = () => JSON.stringify(pageTools().map(mcpPageTool));

  // The list as the agent last could read it, to tell a change to it from
  // a change in availability only.
  let announced = listed();
  // The connection lives as long as the server, so this never unsubscribes.
  connection.subscribe(() => {
    const current = listed();
    if (current === announced) return;
    announced = current;
    // Only while an agent is connected; the notification can't reach it otherwise.
    if (server.transport) void server.sendToolListChanged().catch(() => {});
  });

  // The tools as of the previous result or tool list, whichever came later.
  let seen: ToolState = { tools: [], hidden: [] };

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = pageTools();
    // The list shows neither availability nor hidden tools, so the agent
    // keeps what it last heard of those, and takes a tool new to it as
    // available.
    seen = {
      tools: tools.map(
        ({ name }) =>
          seen.tools.find((tool) => tool.name === name) ?? {
            name,
            available: true,
          }
      ),
      hidden: seen.hidden,
    };
    return {
      tools: [
        ...serverTools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
        ...tools.map(mcpPageTool),
      ],
    };
  });

  const wasOffered = rememberOfferedNames(connection);
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
      const current: ToolState = {
        tools: pageTools().map(({ name, available, reason }) => ({
          name,
          available,
          reason,
        })),
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
