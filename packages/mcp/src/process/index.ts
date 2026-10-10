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
 * offers the same name, and warns once when it finds several servers and
 * cannot tell which to pair with. Returns what ends the connection.
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
  let open: { close(): void } | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  // The pairing with the server it last paired with, once that server
  // handed it a token.
  let known: Pairing | undefined;
  // Whether it said it found several servers since it last paired, so the
  // rescans that follow stay quiet.
  let warnedSeveral = false;

  const later = (next: () => void) => {
    retry = setTimeout(next, SCAN_INTERVAL_MS);
    // The wait never keeps a process running that is otherwise done.
    (retry as { unref?: () => void }).unref?.();
  };

  const scan = async () => {
    const servers = await findServers(ports, await webSocketClass());
    if (disposed) return;
    if (known && servers.includes(known.address)) return pair(known);
    if (servers.length === 1) return pair({ address: servers[0]!, token: "" });
    if (servers.length > 1 && !warnedSeveral) {
      warnedSeveral = true;
      console.warn(
        `[ayme] Found ${servers.length} Ayme MCP servers on ports ${portList(servers)}. Pass \`link\` from the agent's \`ayme_connect\`, or \`port\`, to pick one.`
      );
    }
    later(scan);
  };
  const lookAgain = linked ? () => later(() => pair(linked)) : scan;

  const pair = async (pairing: Pairing) =>
    connect(pairing, await webSocketClass());
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
        void scan();
      },
      onDisconnected() {
        if (ended()) void lookAgain();
      },
      onClose() {
        if (!ended()) return;
        console.info(
          "[ayme] This process lost its connection to the coding agent's Ayme MCP server, and looks for one again."
        );
        void lookAgain();
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
    warnedSeveral = false;
    console.info(
      `[ayme] This process is connected to the coding agent's Ayme MCP server at ${pairing.address}.`
    );
  };

  if (linked) void pair(linked);
  else void scan();
  return {
    dispose() {
      disposed = true;
      clearTimeout(retry);
      open?.close();
      open = undefined;
    },
  };
}

/**
 * Node's own WebSocket, from version 22, or before that the ws package's.
 * Neither sends an Origin, which is how the server knows a local process.
 */
async function webSocketClass(): Promise<typeof WebSocket> {
  return (
    globalThis.WebSocket ??
    ((await import("ws")).WebSocket as unknown as typeof WebSocket)
  );
}

/** The servers' ports, as in "9350, 9351 and 9352". */
function portList(servers: string[]): string {
  const ports = servers.map((address) => new URL(address).port);
  return `${ports.slice(0, -1).join(", ")} and ${ports.at(-1)}`;
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
