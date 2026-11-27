// The Inspector's external build (`./external`, ADR-0049): the page a
// Session's process serves, which shows the Inspector's lenses for the Tab
// the Session works on. It reads the contract over a WebSocket to that
// process, where the inline Inspector calls the runtime's own. The process
// serves it to a browser window, and, with this script inside the page, to
// an agent app that shows it in its chat as an MCP App.
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

import {
  connectAgentApp,
  mountExternalInspector,
  sessionLost,
  showServerLost,
} from "./app";
import {
  replaceInspectorTransport,
  webSocketInspectorContract,
} from "./shared/infrastructure";

/**
 * The id of the element that names the socket of the page an Agent App
 * shows, as JSON `{ "socket": url }`. The Session writes it into that page:
 * the page's own address is the Agent App's, not the Session's.
 */
const AGENT_APP_CONFIG_ID = "ayme-inspector-app";

/** The meta element that names the Session serving the page. */
const SESSION_META = 'meta[name="ayme-session"]';

/** How many times in a row a Session's window, or one in an Agent App,
 * connects again. */
const RETRIES = 3;

/**
 * Starts the Inspector in the window it is served to: it reads the Tab of
 * the Session that served this window, and fills the window. In an Agent
 * App's chat, the page names that Session's socket, and the Inspector talks
 * to the Agent App it is shown in. It stops and says so once it finds no
 * Session after {@link RETRIES} tries, since a new Session gets another
 * port and token.
 */
export function startExternalInspector() {
  const agentApp = document.getElementById(AGENT_APP_CONFIG_ID);
  // A window is admitted by its own origin, the page in a chat by the
  // Session's token in the socket the page names (ADR-0072).
  const socket = agentApp
    ? (JSON.parse(agentApp.textContent ?? "") as { socket: string }).socket
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/inspector/ws`;
  const fullscreen = agentApp ? connectAgentApp(App) : undefined;
  const sessionName =
    document.querySelector(SESSION_META)?.getAttribute("content") ?? "";
  let mounted: ReturnType<typeof mountExternalInspector> | undefined;
  const contract = webSocketInspectorContract(socket, {
    // A new page is a reload as the Inspector in the page has it: it
    // mounts again and picks up what it kept for the tab.
    onNewPage() {
      mounted?.dispose();
      mounted = mountExternalInspector({ fullscreen });
    },
    // A client of its own forgets the Tab before, which no state of a
    // next Tab has yet come to replace.
    onNoTab() {
      mounted?.dispose();
      replaceInspectorTransport(contract, { external: true });
      mounted = mountExternalInspector({ fullscreen });
    },
    onEnded(notice, inChat) {
      mounted?.dispose();
      mounted = undefined;
      showServerLost((agentApp && inChat) || notice);
    },
    retries: RETRIES,
    onLost() {
      mounted?.dispose();
      mounted = undefined;
      showServerLost(sessionLost(sessionName, agentApp !== null));
    },
  });
  replaceInspectorTransport(contract, { external: true });
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
