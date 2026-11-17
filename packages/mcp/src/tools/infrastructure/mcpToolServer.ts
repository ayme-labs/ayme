import {
  toolInputViolations,
  violationSentences,
} from "@ayme-dev/core/tool-input";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type Server } from "@modelcontextprotocol/server";

import { callPageTool } from "../application/callPageTool";
import type {
  AppPage,
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
 * tool's input is the page's to check. A server tool's page for agent apps
 * (`app`) is a resource of the server, linked from the tool's listing, the
 * MCP Apps way.
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
  const { connection, saveImage, failedPageObjects } = context;
  // The SDK's high-level server registers the MCP App pages as resources;
  // the tools stay on this server's own handlers.
  const mcpServer = new McpServer(
    { name, version },
    { capabilities: { tools: { listChanged: true } } }
  );
  const server = mcpServer.server;
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

  for (const { app } of serverTools) if (app) registerAppPage(mcpServer, app);

  server.setRequestHandler("tools/list", () => ({
    tools: [
      ...serverTools.map(({ name, description, inputSchema, app }) => ({
        name,
        description,
        inputSchema,
        ...(app && {
          // The flat key is the one agent apps read before `ui` was nested.
          _meta: { ui: { resourceUri: app.uri }, "ui/resourceUri": app.uri },
        }),
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
      saveImage,
      failedPageObjects
    );
  };

  server.setRequestHandler(
    "tools/call",
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

/** Registers `app` as an MCP App resource of `mcpServer`. */
function registerAppPage(mcpServer: McpServer, app: AppPage) {
  const ui = { csp: { connectDomains: app.connectDomains } };
  registerAppResource(
    mcpServer,
    app.name,
    app.uri,
    { _meta: { ui } },
    async () => ({
      contents: [
        {
          uri: app.uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await app.html(),
          _meta: { ui },
        },
      ],
    })
  );
}
