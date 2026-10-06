import { openPageChannel, type PageTools } from "../connection";
import {
  SERVER_PORTS,
  findServers,
  pairingFromFragment,
  socketUrl,
  type Pairing,
} from "../pairing";
import { processBehaviours } from "./processBehaviours";

/** How long an unpaired App Process waits before it scans again. */
export const SCAN_INTERVAL_MS = 3_000;

/** The part of Ayme's runtime object an App Process uses. */
export type AgentConnectionRuntime = { readonly tools: PageTools };

export type AppProcessOptions = {
  /**
   * A connect link from the agent's `ayme_connect`, which names the server
   * to pair with, as when several run. Without it, the App Process looks
   * for the one server on the port range.
   */
  link?: string;
  /**
   * The one port to look for a server on, in place of the server's range
   * of 9350 to 9365, as for a server started with `ayme mcp --port`.
   */
  port?: number;
};

/**
 * Starts an App Process's side of the Agent Connection, in a Node process
 * of the app such as its dev server, for the runtime object Ayme's setup
 * returns: it pairs with the coding agent's Ayme MCP server beside the
 * page, offers `ayme.tools` there and runs the agent's calls to them.
 *
 * It looks for the server the way a tab's auto-pairing does, and pairs
 * only when exactly one server answers; `link` names one instead. While
 * unpaired it looks again every `SCAN_INTERVAL_MS`, and it looks again
 * when its server goes away, so a process started before the agent pairs
 * once the agent's server is up. It keeps the token the server hands it
 * and reconnects with it while that server runs, even beside another one.
 * It logs each of its tools the server hides because another connection
 * offers the same name. Returns what ends the connection.
 */
export function startAgentConnection(
  ayme: AgentConnectionRuntime,
  { link, port }: AppProcessOptions = {}
): { dispose(): void } {
  const linked = link === undefined ? undefined : linkPairing(link);
  const ports = port === undefined ? SERVER_PORTS : { first: port, last: port };
  // One id for this connection across reconnects, so the server replaces
  // its own earlier session and keeps its place among the App Processes.
  const id = crypto.randomUUID();
  let disposed = false;
  // Node has its own WebSocket from version 22; before, the ws package's.
  // Neither sends an Origin, which is how the server knows a local process.
  let WebSocketClass = globalThis.WebSocket as typeof WebSocket | undefined;
  const withWebSocket = (use: (WebSocketClass: typeof WebSocket) => void) => {
    if (WebSocketClass) return use(WebSocketClass);
    void import("ws").then(({ WebSocket }) => {
      WebSocketClass = WebSocket as unknown as typeof globalThis.WebSocket;
      if (!disposed) use(WebSocketClass);
    });
  };
  let open: { close(): void } | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  // The pairing with the server it last paired with, once that server
  // handed it a token.
  let known: Pairing | undefined;

  const later = (next: () => void) => {
    retry = setTimeout(next, SCAN_INTERVAL_MS);
    // The wait never keeps a process running that is otherwise done.
    (retry as { unref?: () => void }).unref?.();
  };

  const scan = () =>
    withWebSocket((WebSocketClass) => {
      if (disposed) return;
      void findServers(ports, WebSocketClass).then((servers) => {
        if (disposed) return;
        if (known && servers.includes(known.address)) return pair(known);
        if (servers.length === 1)
          return pair({ address: servers[0]!, token: "" });
        later(scan);
      });
    });
  const lookAgain = linked ? () => later(() => pair(linked)) : scan;

  const pair = (pairing: Pairing) =>
    withWebSocket((WebSocketClass) => connect(pairing, WebSocketClass));
  const connect = (pairing: Pairing, WebSocketClass: typeof WebSocket) => {
    if (disposed) return;
    let current = pairing;
    const ended = () => {
      if (open !== opened) return false;
      opened.close();
      open = undefined;
      return true;
    };
    const channel = openPageChannel(() => socketUrl(current), {
      WebSocket: WebSocketClass,
      hello: () => ({ process: id }),
      onWelcome({ token }) {
        if (!token || current.token) return;
        current = { address: pairing.address, token };
        known = current;
      },
      onUnknownPairing() {
        if (!ended()) return;
        if (linked)
          return console.warn(
            `[ayme] The Ayme MCP server at ${linked.address} does not know this connect link. Ask the agent for a new one with ayme_connect.`
          );
        known = undefined;
        scan();
      },
      onDisconnected() {
        if (ended()) lookAgain();
      },
      onClose() {
        if (!ended()) return;
        console.info(
          "[ayme] This process lost its connection to the coding agent's Ayme MCP server, and looks for one again."
        );
        lookAgain();
      },
    });
    const stops = processBehaviours.map((behaviour) =>
      behaviour({ tools: ayme.tools, channel })
    );
    const opened = {
      close() {
        for (const stop of stops) stop();
        channel.close();
      },
    };
    open = opened;
    console.info(
      `[ayme] This process is connected to the coding agent's Ayme MCP server at ${pairing.address}.`
    );
  };

  if (linked) pair(linked);
  else scan();
  return {
    dispose() {
      disposed = true;
      clearTimeout(retry);
      open?.close();
      open = undefined;
    },
  };
}

/** The pairing `link` names; throws when it is not a connect link. */
function linkPairing(link: string): Pairing {
  let pairing: Pairing | undefined;
  try {
    pairing = pairingFromFragment(new URL(link).hash);
  } catch {
    pairing = undefined;
  }
  if (!pairing)
    throw new Error(
      `Expected a connect link from the agent's ayme_connect, such as http://localhost:5173/#ayme=ws://127.0.0.1:9350/<token>, got "${link}".`
    );
  return pairing;
}
