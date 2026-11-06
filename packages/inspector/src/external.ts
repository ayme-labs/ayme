// The Inspector's external build (`./external`, ADR-0049): the page that
// `ayme mcp` serves, which shows the Inspector's lenses for the page paired
// with that server. It reads the contract over a WebSocket to the server
// that served it, where the inline Inspector calls the runtime's own.
import { mountExternalInspector } from "./app";
import {
  replaceInspectorTransport,
  webSocketInspectorContract,
} from "./shared";

/**
 * Starts the Inspector in the window it is served to: it reads the page
 * behind the server that served this window, and fills the window.
 */
export function startExternalInspector({ protocol, host } = window.location) {
  let mounted: ReturnType<typeof mountExternalInspector> | undefined;
  replaceInspectorTransport(
    webSocketInspectorContract(
      `${protocol === "https:" ? "wss:" : "ws:"}//${host}/inspector/ws`,
      {
        // A new page is a reload as the Inspector in the page has it: it
        // mounts again and picks up what it kept for the tab.
        onNewPage() {
          mounted?.dispose();
          mounted = mountExternalInspector();
        },
      }
    ),
    { external: true }
  );
  mounted = mountExternalInspector();
  return {
    dispose() {
      mounted?.dispose();
    },
  };
}

// The served page loads this script to start it; imported where there is no
// window, as a package check does, it only exports.
if (typeof window !== "undefined") startExternalInspector();
