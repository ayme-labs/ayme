import {
  toolInputViolations,
  violationSentences,
} from "@ayme-dev/core/tool-input";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import {
  CLIENT_INFO_META_KEY,
  McpServer,
  type Implementation,
  type ServerContext,
} from "@modelcontextprotocol/server";

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
  type McpListedTool,
  type ToolResult,
} from "../domain/toolResult";

/**
 * One server object an agent talks to, built each time `serveStdio` asks
 * for one: the server's own tools, then the tools of the paired page and
 * App Processes under the names they give them (see
 * `AgentConnection` for which of two same-named tools the agent sees), as
 * the server's `AgentToolView` lists them. While nothing is paired, any
 * other name answers that no page is connected, since it may be a page tool
 * the agent listed before. One server object serves one agent, so that
 * view says when the agent hears `notifications/tools/list_changed` (under
 * 2026-07-28, the SDK passes it on only to a subscription that asked for
 * it), and every tool result but a Page Object Tool's carries its tool
 * change note, if any, as a text item after the tool's own, in every
 * revision: a Page Object Tool answers with what the page answered alone.
 * The object listens to the connection until it closes, which leaves the
 * connection to the next one. A server tool's input is checked against its input schema
 * before the tool runs, with arguments left out taken as `{}`; a page
 * tool's input is the page's to check. A server tool's page for Agent Apps
 * (`app`) is a resource of the server, linked from the tool's listing, the
 * MCP Apps way.
 *
 * `agentNamed` hears the agent's name: under the older revisions from the
 * `initialize` handshake, under 2026-07-28 from each `tools/list` and
 * `tools/call` request's `_meta`, the only place it is given there.
 */
export function createMcpToolServer({
  name,
  version,
  serverTools: serverToolFactories,
  context,
  agentNamed,
}: {
  name: string;
  version: string;
  serverTools: readonly ServerToolFactory[];
  /** What the server tools may use, besides what the agent was shown. */
  context: Omit<ServerToolContext, "wasOffered">;
  /** Hears the agent's name each time a request or the handshake gives it. */
  agentNamed: (name: string) => void;
}): McpServer {
  const { connection, pageObjectsBuildState } = context;
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

  server.onclose = connection.subscribe(() => {
    if (!view.toolsChanged(connection.tools)) return;
    // Only while an agent is connected; the notification can't reach it otherwise.
    if (server.transport) void server.sendToolListChanged().catch(() => {});
  });

  for (const { app } of serverTools) if (app) registerAppPage(mcpServer, app);

  // Under the older revisions the name comes with `initialize`; under
  // 2026-07-28 with each request's `_meta`, which the SDK lifts out into
  // the envelope, as `getClientVersion()` stays empty there over stdio.
  const nameAgent = (ctx?: ServerContext) => {
    // The SDK's published types leave the envelope's keys out.
    const envelope = ctx?.mcpReq.envelope as
      { [CLIENT_INFO_META_KEY]?: Implementation } | undefined;
    const client =
      envelope?.[CLIENT_INFO_META_KEY] ?? server.getClientVersion();
    if (client?.name) agentNamed(client.name);
  };
  server.oninitialized = () => nameAgent();

  server.setRequestHandler("tools/list", (_request, ctx) => {
    nameAgent(ctx);
    const tools: McpListedTool[] = [
      ...serverTools.map(({ name, description, inputSchema, app }) => ({
        name,
        description,
        inputSchema,
        ...(app && {
          // The flat key is the one Agent Apps read before `ui` was nested.
          _meta: { ui: { resourceUri: app.uri }, "ui/resourceUri": app.uri },
        }),
      })),
      ...view.listRead(connection.tools).map(mcpPageTool),
    ];
    return { tools };
  });

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
      pageObjectsBuildState
    );
  };

  server.setRequestHandler(
    "tools/call",
    async (request, ctx): Promise<ToolResult> => {
      nameAgent(ctx);
      const { name, arguments: input = {} } = request.params;
      // `ayme_call` answers what the tool it names answers.
      const called =
        name === "ayme_call" && typeof input.tool === "string"
          ? input.tool
          : name;
      // Asked of the view, which keeps the tool's group while the page's tab
      // reconnects and a held call waits for it.
      const pageObjectTool = view.offeredAsPageObject(called);
      const result = await run(name, input);
      if (pageObjectTool) return result;
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

  return mcpServer;
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
