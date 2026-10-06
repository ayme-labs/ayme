import {
  openPageChannel,
  type PageChannel,
  type PageTools,
} from "../connection";
import type { PageTool } from "../contract";
import {
  forgetStoredPairing,
  socketUrl,
  storePairing,
  storedTabId,
  type Pairing,
} from "../pairing";
import { clientBehaviours } from "./clientBehaviours";
import { pairingSources } from "./pairingSources";

/** The part of Ayme's runtime object the page client uses. */
export type AgentConnectionRuntime = { readonly tools: PageTools };

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

const NO_TOOLS: readonly PageTool[] = Object.freeze([]);

/**
 * Starts the page's side of the Agent Connection for the runtime object
 * Ayme's setup returns. Ayme calls it for the `agentConnection` option.
 * Each pairing the page learns, such as from a connect link or the tab's
 * stored pairing, opens a channel to that server in place of the previous
 * one. A page that paired without a token keeps the token the server hands
 * it, and reconnects with it. When the server says another tab paired in
 * this tab's place, the tab forgets its pairing; when it does not know the
 * pairing, the tab forgets it and looks for a server again. When a busy
 * server refuses its pairing without a token, it looks again from its next
 * focus. Returns what ends the connection, and the tools of the App
 * Processes paired with the server, which the server sends the tab.
 */
export function startAgentConnection(ayme: AgentConnectionRuntime): {
  dispose(): void;
  processTools: AppProcessTools;
} {
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
  if (typeof window === "undefined") return { dispose() {}, processTools };
  let stopSources: (() => void)[] = [];
  const startSources = (lookNow = true) => {
    for (const stop of stopSources) stop();
    stopSources = pairingSources.map((source) => source(pair, { lookNow }));
  };
  const pair = (pairing: Pairing) => {
    const tab = storedTabId(pairing);
    const key = `${socketUrl(pairing)} ${tab}`;
    // A connect link and the pairing it stored name the same channel.
    if (open?.key === key) return;
    open?.close();
    let current: Pairing = pairing;
    const channel = openPageChannel(() => socketUrl(current), {
      hello: () => ({ tab, url: window.location.href }),
      onWelcome({ token }) {
        if (!token || current.token) return;
        current = { address: pairing.address, token };
        storePairing({ ...current, tab });
      },
      onUnknownPairing() {
        if (open !== opened) return;
        opened.close();
        open = undefined;
        forgetStoredPairing(tab);
        startSources();
      },
      onDisconnected() {
        if (open !== opened) return;
        opened.close();
        open = undefined;
        forgetStoredPairing(tab);
        // A busy server refused the tokenless pairing: the tab has none,
        // and looks again from its next focus.
        if (!current.token) return startSources(false);
        console.info(
          "[ayme] This tab is no longer connected to the coding agent: another tab connected to its Ayme MCP server."
        );
      },
    });
    const stops = clientBehaviours.map((behaviour) =>
      behaviour({ tools: ayme.tools, channel })
    );
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
      for (const stop of stopSources) stop();
      open?.close();
      open = undefined;
    },
    processTools,
  };
}
