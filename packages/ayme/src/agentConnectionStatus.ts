import type { NotConnectedReason } from "@ayme-dev/mcp/client";

import type { Ayme } from "./runtime";

/**
 * Whether the session's page is connected to a coding agent through the
 * agent's Ayme MCP server, for the Inspector: `off` without the
 * `agentConnection` option, else as the page client reports it.
 * `not-connected` says why once the tab knows, `no-client` when the page
 * client failed to load; `connected` names the agent when its MCP client
 * gave a name, such as `claude-code`.
 */
export type AgentConnectionStatus = Readonly<
  | { state: "off" }
  | {
      state: "not-connected";
      reason?: NotConnectedReason | "no-client";
    }
  | { state: "connected"; agent?: string }
>;

/** The page client's own status, which leaves out `off`. */
type ClientStatus = Exclude<AgentConnectionStatus, { state: "off" }>;

/** The page client's status as it hands it over. */
export type ClientStatusSource = {
  get(): ClientStatus;
  subscribe(listener: (status: ClientStatus) => void): () => void;
};

/** A session's Agent Connection status, kept current. */
export type AgentConnectionStatusSource = {
  /** The same object comes back until the status changes. */
  get(): AgentConnectionStatus;
  /** Calls `listener` with the new status after each change. */
  subscribe(listener: (status: AgentConnectionStatus) => void): () => void;
};

const OFF: AgentConnectionStatus = Object.freeze({ state: "off" });
const NOT_CONNECTED: AgentConnectionStatus = Object.freeze({
  state: "not-connected",
});
const NO_CLIENT: ClientStatus = Object.freeze({
  state: "not-connected",
  reason: "no-client",
});

// A page client that failed to load reports this, and never changes.
const noClient: ClientStatusSource = {
  get: () => NO_CLIENT,
  subscribe: () => () => {},
};

const bySession = new WeakMap<Ayme, AgentConnectionStatusSource>();
const offSource: AgentConnectionStatusSource = {
  get: () => OFF,
  subscribe: () => () => {},
};

/** The Agent Connection status of the session `ayme`, for the Inspector. */
export function getAgentConnectionStatus(
  ayme: Ayme
): AgentConnectionStatusSource {
  return bySession.get(ayme) ?? offSource;
}

/** Makes `status` the one `getAgentConnectionStatus(ayme)` returns. */
export function setAgentConnectionStatus(
  ayme: Ayme,
  status: AgentConnectionStatusSource
) {
  bySession.set(ayme, status);
}

/**
 * A session's status, for a session with the `agentConnection` option when
 * `on`: `off` without it; with it, not connected until the page client it
 * follows says otherwise, and again once it follows none.
 */
export function createAgentConnectionStatus(on: boolean) {
  const idle = on ? NOT_CONNECTED : OFF;
  let followed: ClientStatusSource | undefined;
  let unfollow = () => {};
  const listeners = new Set<(status: AgentConnectionStatus) => void>();
  const get = () => followed?.get() ?? idle;
  const announce = () => {
    const status = get();
    for (const listener of listeners) listener(status);
  };
  const follow = (next: ClientStatusSource | undefined) => {
    unfollow();
    followed = next;
    unfollow = next?.subscribe(announce) ?? (() => {});
    announce();
  };
  return {
    status: {
      get,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } satisfies AgentConnectionStatusSource,
    /** Follows the page client's status, or none. */
    follow,
    /** Says the page client failed to load, until it follows another. */
    failed: () => follow(noClient),
  };
}
