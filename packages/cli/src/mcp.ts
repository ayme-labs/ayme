// `ayme mcp`: MCP over stdio for an Agent App, with one job, showing the
// Inspector of a Session in the Agent App's chat (MCP Apps). An agent reads
// and acts on the page through the `ayme` commands, never through it.
import { agentAppPage, askSession } from "@ayme-dev/session";
import { McpServer } from "@modelcontextprotocol/server";
import {
  StdioServerTransport,
  serveStdio,
} from "@modelcontextprotocol/server/stdio";

import { version } from "../package.json";

const INSPECTOR_URI = "ui://ayme/inspector.html";

/** The MIME type of a page an Agent App shows (MCP Apps), as
 * `@modelcontextprotocol/ext-apps` names it: its server helpers only add
 * this and the tool's `_meta` below, so the command bundles none of it. */
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

type Place = { readonly projectDir: string; readonly name?: string };

/**
 * One server object an Agent App talks to: one tool, `ayme_inspect`, which
 * reads nothing from the page and acts on nothing, and whose page is the
 * Inspector of `place`'s Session with the Inspector's built `script` in
 * it. An Agent App needs the tool to show the page: it shows a tool's page
 * when the tool is called. Each asks the Session afresh, so it follows a
 * Session started after `ayme mcp`.
 */
export function inspectorServer(place: Place, script: string): McpServer {
  const server = new McpServer({ name: "ayme", version });
  server.registerTool(
    "ayme_inspect",
    {
      description:
        "Shows the developer the Inspector of the Session in this chat, when the Agent App shows MCP Apps: the Page Objects and Page Object Tools of the Session's Tab, to watch and run by hand. It reads nothing from the page for you and acts on nothing: run ayme page-objects, ayme tools and ayme call for that.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      // The flat key is the one Agent Apps read before `ui` was nested.
      _meta: {
        ui: { resourceUri: INSPECTOR_URI },
        "ui/resourceUri": INSPECTOR_URI,
      },
    },
    async () => {
      const { ok, text } = await askSession(place, {
        inspector: { agentApp: {} },
      });
      return {
        content: [{ type: "text", text }],
        ...(ok ? {} : { isError: true }),
      };
    }
  );
  server.registerResource(
    "Inspector",
    INSPECTOR_URI,
    { mimeType: MCP_APP_MIME_TYPE },
    async () => {
      const { html, connectDomains } = await agentAppPage(place, script);
      const ui = { csp: { connectDomains: [...connectDomains] } };
      return {
        contents: [
          {
            uri: INSPECTOR_URI,
            mimeType: MCP_APP_MIME_TYPE,
            text: html,
            _meta: { ui },
          },
        ],
      };
    }
  );
  return server;
}

/**
 * Serves {@link inspectorServer} over stdio, under revision 2026-07-28 and
 * the older ones that open with `initialize`, and resolves once the
 * connection to the Agent App closes.
 */
export function serveMcp(place: Place, script: string): Promise<void> {
  return new Promise((resolve) => {
    const transport = new StdioServerTransport();
    const close = transport.close.bind(transport);
    transport.close = async () => {
      await close();
      resolve();
    };
    serveStdio(() => inspectorServer(place, script), { transport });
  });
}
