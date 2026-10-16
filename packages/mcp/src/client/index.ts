import {
  openPageChannel,
  type AgentImageRun,
  type PageChannel,
  type PageTools,
} from "../connection";
import type { PageTool } from "../contract";
import {
  forgetStoredPairing,
  socketUrl,
  storePairing,
  storedTabId,
  type NotConnectedReason,
  type Pairing,
} from "../pairing";
import { clientBehaviours } from "./clientBehaviours";
import { pairingSources } from "./pairingSources";

export type { AgentImageRun } from "../connection";
export type { NotConnectedReason } from "../pairing";

/**
 * The part of Ayme's runtime object the page client uses, and where it
 * records an agent's call whose result is an image, for the Inspector.
 */
export type AgentConnectionRuntime = {
  readonly tools: PageTools;
  readonly recordAgentImage?: (run: AgentImageRun) => void;
};

/**
 * The tools of the App Processes paired with the tab's server, as the
 * Inspector shows and runs them. None while no server is paired.
 */
export type AppProcessTools = {
  /** The same array comes back until the list changes. */
  list(): readonly PageTool[];
  /** Calls `listener` with the new list after each change. */
  subscribe(listener: (tools: readonly PageTool[]) => void): () => void;
  /**
   * Runs one through the server, which sends it to its App Process, and
   * resolves with its result. Throws the tool's error, or when no server
   * is paired.
   */
  run(name: string, input: unknown): Promise<unknown>;
};

/**
 * Whether the tab is connected to an agent's Ayme MCP server: `connected`
 * once the server welcomed it, with the name the agent's MCP client gave
 * the server, if any; else `not-connected`, with why, once the tab knows.
 */
export type AgentConnectionStatus = Readonly<
  | { state: "not-connected"; reason?: NotConnectedReason }
  | { state: "connected"; agent?: string }
>;

/** The tab's connection status, for the Inspector. */
export type AgentConnectionStatusSource = {
  /** The same object comes back until the status changes. */
  get(): AgentConnectionStatus;
  /** Calls `listener` with the new status after each change. */
  subscribe(listener: (status: AgentConnectionStatus) => void): () => void;
};

const NO_TOOLS: readonly PageTool[] = Object.freeze([]);

/**
 * How long a tab that lost its server says it is reconnecting before it
 * says the server stopped answering. It keeps trying after that.
 */
const RECONNECTING_MS = 10_000;

/**
 * Starts the page's side of the Agent Connection for the runtime object
 * Ayme's setup returns. Ayme calls it for the `agentConnection` option.
 * Each pairing the page learns, such as from a connect link or the tab's
 * stored pairing, opens a channel to that server in place of the previous
 * one. When the channel loses its server, the tab says it is reconnecting,
 * and after 10 s without a welcome that the server stopped answering,
 * while it keeps trying. A page that paired without a token keeps the
 * token the server hands it, and reconnects with it. When the server says
 * another tab paired in this tab's place, the tab forgets its pairing; when
 * it does not know the pairing, the tab forgets it and looks for a server
 * again. When a busy server refuses its pairing without a token, it looks
 * again from its next focus. Returns what ends the connection, the tools of
 * the App Processes paired with the server, which the server sends the
 * tab, and whether the tab is connected.
 */
export function startAgentConnection(ayme: AgentConnectionRuntime): {
  dispose(): void;
  processTools: AppProcessTools;
  status: AgentConnectionStatusSource;
} {
  let currentStatus: AgentConnectionStatus = Object.freeze({
    state: "not-connected",
  });
  const statusListeners = new Set<(status: AgentConnectionStatus) => void>();
  // The wait after a loss, which any other change of status ends.
  let reconnecting: ReturnType<typeof setTimeout> | undefined;
  const setStatus = (next: AgentConnectionStatus) => {
    if (JSON.stringify(next) === JSON.stringify(currentStatus)) return;
    clearTimeout(reconnecting);
    currentStatus = Object.freeze(next);
    for (const listener of statusListeners) listener(currentStatus);
  };
  const notConnected = (reason?: NotConnectedReason) =>
    setStatus(
      reason ? { state: "not-connected", reason } : { state: "not-connected" }
    );
  const status: AgentConnectionStatusSource = {
    get: () => currentStatus,
    subscribe(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
  let processToolList = NO_TOOLS;
  const processToolListeners = new Set<(tools: readonly PageTool[]) => void>();
  const setProcessTools = (tools: readonly PageTool[]) => {
    if (tools.length === 0 && processToolList.length === 0) return;
    processToolList = tools.length === 0 ? NO_TOOLS : Object.freeze([...tools]);
    for (const listener of processToolListeners) listener(processToolList);
  };
  let open: { key: string; channel: PageChannel; close(): void } | undefined;
  const processTools: AppProcessTools = {
    list: () => processToolList,
    subscribe(listener) {
      processToolListeners.add(listener);
      return () => {
        processToolListeners.delete(listener);
      };
    },
    async run(name, input) {
      if (!open) throw new Error("No Ayme MCP server is paired with this tab.");
      const outcome = await open.channel.callProcessTool(name, input);
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.result;
    },
  };
  let stopSources: (() => void)[] = [];
  const startSources = (lookNow = true) => {
    for (const stop of stopSources) stop();
    stopSources = pairingSources.map((source) =>
      source(pair, {
        lookNow,
        onUnpaired(reason) {
          if (!open) notConnected(reason);
        },
      })
    );
  };
  const pair = (pairing: Pairing) => {
    const tab = storedTabId(pairing);
    const key = `${socketUrl(pairing)} ${tab}`;
    // A connect link and the pairing it stored name the same channel.
    if (open?.key === key) return;
    open?.close();
    notConnected("connecting");
    let current: Pairing = pairing;
    // Whether it lost the server since its last welcome: the channel
    // reports each failed retry as a loss too.
    let lost = false;
    const channel = openPageChannel(() => socketUrl(current), {
      hello: () => ({ tab, url: window.location.href }),
      onWelcome({ token, agent }) {
        lost = false;
        if (open === opened)
          setStatus(
            agent ? { state: "connected", agent } : { state: "connected" }
          );
        if (!token || current.token) return;
        current = { address: pairing.address, token };
        storePairing({ ...current, tab });
      },
      onUnknownPairing() {
        if (open !== opened) return;
        opened.close();
        open = undefined;
        forgetStoredPairing(tab);
        notConnected();
        startSources();
      },
      onLost() {
        if (open !== opened || lost) return;
        lost = true;
        notConnected("reconnecting");
        reconnecting = setTimeout(() => {
          if (open === opened) notConnected("no-answer");
        }, RECONNECTING_MS);
      },
      onDisconnected() {
        if (open !== opened) return;
        opened.close();
        open = undefined;
        forgetStoredPairing(tab);
        notConnected("other-tab");
        // A busy server refused the tokenless pairing: the tab has none,
        // and looks again from its next focus.
        if (!current.token) return startSources(false);
        console.info(
          "[ayme] This tab is no longer connected to the coding agent: another tab connected to its Ayme MCP server."
        );
      },
    });
    const stops = clientBehaviours.map((behaviour) =>
      behaviour({
        tools: ayme.tools,
        channel,
        recordAgentImage: ayme.recordAgentImage,
      })
    );
    // Not a ClientBehaviour: it feeds `processTools`, which this function
    // returns, and a behaviour's context carries no such sink.
    stops.push(channel.followProcessTools(setProcessTools));
    const opened = {
      key,
      channel,
      close() {
        for (const stop of stops) stop();
        channel.close();
        setProcessTools(NO_TOOLS);
      },
    };
    open = opened;
  };
  startSources();
  return {
    dispose() {
      clearTimeout(reconnecting);
      for (const stop of stopSources) stop();
      open?.close();
      open = undefined;
    },
    processTools,
    status,
  };
}
