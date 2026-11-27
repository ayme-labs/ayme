// The Inspector's external build (`./external`, ADR-0049): the page that
// `ayme mcp` or a Session's process serves, which shows the Inspector's
// lenses for the page paired with that server or the Tab the Session works
// on. It reads the contract over a WebSocket to that server, where the
// inline Inspector calls the runtime's own. Each serves it to a browser
// window, and, with this script inside the page, to an agent app that
// shows it in its chat as an MCP App.
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

import {
  connectAgentApp,
  mountExternalInspector,
  showServerLost,
  windowAdmission,
} from "./app";
import {
  replaceInspectorTransport,
  webSocketInspectorContract,
} from "./shared/infrastructure";

/**
 * The id of the element that names the socket of the page an Agent App
 * shows, as JSON `{ "socket": url }`. `ayme mcp` writes it into that page:
 * the page's own address is the Agent App's, not the server's.
 */
const AGENT_APP_CONFIG_ID = "ayme-inspector-app";

/** The meta element a Session's pages carry, which no page of
 * `@ayme-dev/mcp`'s server does. */
const SESSION_META = 'meta[name="ayme-session"]';

/** How many times in a row a Session's window, or one in an Agent App,
 * connects again. */
const RETRIES = 3;

/**
 * Starts the Inspector in the window it is served to: it reads the page
 * behind the server that served this window, and fills the window. In an
 * Agent App's chat, the page names that server's socket, and the Inspector
 * talks to the Agent App it is shown in. A Session's window, and one in an
 * Agent App, stops and says so once it finds no server after {@link RETRIES}
 * tries, since a new Session gets another port and token; the window of
 * `@ayme-dev/mcp`'s server goes on trying, since that server may start
 * again at the same address.
 */
export function startExternalInspector() {
  const agentApp = document.getElementById(AGENT_APP_CONFIG_ID);
  const admission = agentApp ? undefined : windowAdmission(window);
  const socket = admission
    ? admission.socket
    : (JSON.parse(agentApp?.textContent ?? "") as { socket: string }).socket;
  const fullscreen = agentApp ? connectAgentApp(App) : undefined;
  const session = document.querySelector(SESSION_META) !== null;
  let mounted: ReturnType<typeof mountExternalInspector> | undefined;
  replaceInspectorTransport(
    webSocketInspectorContract(socket, {
      followsTabs: session,
      ...(admission && { onToken: admission.admitted }),
      // A new page is a reload as the Inspector in the page has it: it
      // mounts again and picks up what it kept for the tab.
      onNewPage() {
        mounted?.dispose();
        mounted = mountExternalInspector({ fullscreen, session });
      },
      onEnded(notice) {
        mounted?.dispose();
        mounted = undefined;
        showServerLost(notice);
      },
      ...((agentApp || session) && {
        retries: RETRIES,
        onLost() {
          mounted?.dispose();
          mounted = undefined;
          showServerLost();
        },
      }),
    }),
    { external: true }
  );
  mounted = mountExternalInspector({ fullscreen, session });
  return {
    dispose() {
      mounted?.dispose();
    },
  };
}

// The served page loads this script to start it; imported where there is no
// window, as a package check does, it only exports.
if (typeof window !== "undefined") startExternalInspector();
