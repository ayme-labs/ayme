import { openPageChannel, type PageTools } from "../connection";
import { socketUrl, type Pairing } from "../pairing";
import { clientBehaviours } from "./clientBehaviours";
import { pairingSources } from "./pairingSources";

/** The part of Ayme's runtime object the page client uses. */
export type AgentConnectionRuntime = { readonly tools: PageTools };

/**
 * Starts the page's side of the Agent Connection for the runtime object
 * Ayme's setup returns. Ayme calls it for the `agentConnection` option.
 * Each pairing the page learns, such as from a connect link, opens a
 * channel to that server in place of the previous one. Returns what ends
 * the connection.
 */
export function startAgentConnection(ayme: AgentConnectionRuntime): {
  dispose(): void;
} {
  if (typeof window === "undefined") return { dispose() {} };
  let closeChannel: (() => void) | undefined;
  const pair = (pairing: Pairing) => {
    closeChannel?.();
    const channel = openPageChannel(socketUrl(pairing));
    const stops = clientBehaviours.map((behaviour) =>
      behaviour({ tools: ayme.tools, channel })
    );
    closeChannel = () => {
      for (const stop of stops) stop();
      channel.close();
    };
  };
  const stopSources = pairingSources.map((source) => source(pair));
  return {
    dispose() {
      for (const stop of stopSources) stop();
      closeChannel?.();
      closeChannel = undefined;
    },
  };
}
