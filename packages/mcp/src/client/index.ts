import { openPageChannel, type PageTools } from "../connection";
import {
  forgetStoredPairing,
  socketUrl,
  storedTabId,
  type Pairing,
} from "../pairing";
import { clientBehaviours } from "./clientBehaviours";
import { pairingSources } from "./pairingSources";

/** The part of Ayme's runtime object the page client uses. */
export type AgentConnectionRuntime = { readonly tools: PageTools };

/**
 * Starts the page's side of the Agent Connection for the runtime object
 * Ayme's setup returns. Ayme calls it for the `agentConnection` option.
 * Each pairing the page learns, such as from a connect link or the tab's
 * stored pairing, opens a channel to that server in place of the previous
 * one. When the server says another tab paired in this tab's place, the
 * tab forgets its pairing. Returns what ends the connection.
 */
export function startAgentConnection(ayme: AgentConnectionRuntime): {
  dispose(): void;
} {
  if (typeof window === "undefined") return { dispose() {} };
  let open: { key: string; close(): void } | undefined;
  const pair = (pairing: Pairing) => {
    const tab = storedTabId(pairing);
    const key = `${socketUrl(pairing)} ${tab}`;
    // A connect link and the pairing it stored name the same channel.
    if (open?.key === key) return;
    open?.close();
    const channel = openPageChannel(socketUrl(pairing), {
      tab,
      onDisconnected() {
        if (open !== current) return;
        current.close();
        open = undefined;
        forgetStoredPairing(tab);
        console.info(
          "[ayme] This tab is no longer connected to the coding agent: another tab connected to its Ayme MCP server."
        );
      },
    });
    const stops = clientBehaviours.map((behaviour) =>
      behaviour({ tools: ayme.tools, channel })
    );
    const current = {
      key,
      close() {
        for (const stop of stops) stop();
        channel.close();
      },
    };
    open = current;
  };
  const stopSources = pairingSources.map((source) => source(pair));
  return {
    dispose() {
      for (const stop of stopSources) stop();
      open?.close();
      open = undefined;
    },
  };
}
