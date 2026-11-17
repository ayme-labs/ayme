// The Inspector's external build (`./external`, ADR-0049): the page that
// `ayme mcp` serves, which shows the Inspector's lenses for the page paired
// with that server. It reads the contract over a WebSocket to that server,
// where the inline Inspector calls the runtime's own. `ayme mcp` serves it
// to a browser window, and, with this script inside the page, to an agent
// app that shows it in its chat as an MCP App.
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

import { connectAgentApp, mountExternalInspector, showServerLost } from "./app";
import {
  replaceInspectorTransport,
  webSocketInspectorContract,
} from "./shared";

/**
 * The id of the element that names the socket of the page an Agent App
 * shows, as JSON `{ "socket": url }`. `ayme mcp` writes it into that page:
 * the page's own address is the Agent App's, not the server's.
 */
const AGENT_APP_CONFIG_ID = "ayme-inspector-app";

/** How many times in a row a window in an Agent App connects again. */
const AGENT_APP_RETRIES = 3;

/**
 * Starts the Inspector in the window it is served to: it reads the page
 * behind the server that served this window, and fills the window. In an
 * Agent App's chat, the page names that server's socket, and the Inspector
 * talks to the Agent App it is shown in. There, the socket's token ends with
 * the server, so a window that finds no server after {@link AGENT_APP_RETRIES}
 * tries stops and says so; a browser window goes on trying, since the server
 * it is served by may start again at the same address.
 */
export function startExternalInspector() {
  const agentApp = document.getElementById(AGENT_APP_CONFIG_ID);
  const { protocol, host } = window.location;
  const socket = agentApp
    ? (JSON.parse(agentApp.textContent ?? "") as { socket: string }).socket
    : `${protocol === "https:" ? "wss:" : "ws:"}//${host}/inspector/ws`;
  const fullscreen = agentApp ? connectAgentApp(App) : undefined;
  let mounted: ReturnType<typeof mountExternalInspector> | undefined;
  replaceInspectorTransport(
    webSocketInspectorContract(socket, {
      // A new page is a reload as the Inspector in the page has it: it
      // mounts again and picks up what it kept for the tab.
      onNewPage() {
        mounted?.dispose();
        mounted = mountExternalInspector({ fullscreen });
      },
      ...(agentApp && {
        retries: AGENT_APP_RETRIES,
        onLost() {
          mounted?.dispose();
          mounted = undefined;
          showServerLost();
        },
      }),
    }),
    { external: true }
  );
  mounted = mountExternalInspector({ fullscreen });
  return {
    dispose() {
      mounted?.dispose();
    },
  };
}

// The served page loads this script to start it; imported where there is no
// window, as a package check does, it only exports.
if (typeof window !== "undefined") startExternalInspector();
