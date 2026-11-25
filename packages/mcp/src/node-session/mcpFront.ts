// Spike: `ayme mcp` as a second front on the background process. The
// background process connects to the server the way something already
// does: as an App Process (`process`), or as a page (`page`), whose hello
// names a tab the process makes up. Nothing of Ayme enters the page for it.
import {
  openPageChannel,
  type InspectorPort,
  type PageTools,
} from "../connection";
import { serveInspector } from "../inspector";
import { OUR_AYME, findServers, socketUrl, type Pairing } from "../pairing";
import { startAgentConnection } from "../process";
import { answerToolCalls, publishPageTools } from "../tools";

/** Placeholder: how the background process says hello to the server. */
export type McpFrontKind = "process" | "page";

/**
 * Connects the session's `tools` to the `ayme mcp` server on `port`, as
 * `kind` says. As a page it also serves `inspector`, the session's Inspector
 * contract, to an external Inspector window. Returns what ends it.
 */
export async function connectMcpFront({
  kind,
  port,
  tools,
  url,
  inspector,
  tab,
  log,
}: {
  /**
   * Placeholder: the tab id the page's hello names, the same for every
   * process of the session, so a restarted process is the same tab to the
   * server, which refuses another tab while it waits for this one.
   */
  tab: string;
  kind: McpFrontKind;
  port: number;
  tools: PageTools;
  /** The tab's URL now, for the page's hello. */
  url: () => string;
  inspector?: InspectorPort;
  log(message: string): void;
}): Promise<{ dispose(): void }> {
  if (kind === "process") return startAgentConnection({ tools }, { port });

  // As a page: one channel for the process's life, whatever the tab loads,
  // since the session outlives the tab's documents. It reports no
  // navigation: the Node session waits for a load itself.
  const [address] = await findServers(
    { first: port, last: port },
    globalThis.WebSocket
  );
  if (address === undefined)
    throw new Error(`No ayme mcp server answers on port ${port}.`);
  let current: Pairing = { address, token: "" };
  const channel = openPageChannel(() => socketUrl(current), {
    WebSocket: globalThis.WebSocket,
    hello: () => ({ tab, url: url(), ...OUR_AYME }),
    onWelcome({ token, agent }) {
      log(
        `Paired with ${address} as a page${agent ? `, agent ${agent}` : ""}.`
      );
      if (token && !current.token) current = { address, token };
    },
    onDisconnected: () =>
      log("The server paired another tab in this one's place."),
    onUnknownPairing: () => log("The server does not know this pairing."),
    onVersionGap: (gap) => log(gap),
    onLost: () => log("Lost the server; reconnecting."),
  });
  const stops = [publishPageTools, answerToolCalls, serveInspector].map(
    (behaviour) => behaviour({ tools, channel, inspector })
  );
  return {
    dispose() {
      for (const stop of stops) stop();
      channel.close();
    },
  };
}
