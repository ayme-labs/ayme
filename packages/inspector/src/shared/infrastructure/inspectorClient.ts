import { useSyncExternalStore } from "react";

import {
  inlineInspectorContract,
  mergeInspectorState,
  type InspectorAgentImageRun,
  type InspectorCommandResult,
  type InspectorContract,
  type InspectorHighlightLayer,
  type InspectorState,
} from "@ayme-dev/ayme/inspector";
import type { Caller, JsonValue } from "@ayme-dev/ayme";

/** What the client holds before the transport has answered: nothing, at revision 0. */
export const emptyInspectorState: InspectorState = Object.freeze({
  revision: 0,
  tools: Object.freeze([]),
  appProcessTools: Object.freeze([]),
  publication: Object.freeze({
    state: "disposed",
    message: "No Ayme runtime session has started.",
  }),
  agentConnection: Object.freeze({ state: "off" }),
  runs: Object.freeze([]),
}) as InspectorState;

/**
 * The Inspector's client of the contract the runtime serves: it keeps the
 * newest state it has heard, tells its listeners when that changes, and
 * sends the Inspector's commands. The transport it is built on is the
 * contract itself: inline it is the runtime's own, called directly with no
 * serialization; a channel to `ayme mcp` is another (#1181).
 */
export type InspectorClient = {
  /** The newest state held; the same object until it changes. */
  current(): InspectorState;
  /**
   * Calls `listener` after the held state changes. The transport is
   * followed while anyone listens.
   */
  subscribe(listener: () => void): () => void;
  /** Calls `listener` with each agent's image Run `ayme mcp` reports. */
  onAgentImageRun(listener: (run: InspectorAgentImageRun) => void): () => void;
  runTool(request: {
    name: string;
    input?: JsonValue;
    by?: Caller;
  }): Promise<InspectorCommandResult>;
  /** Makes `refs` the elements `layer` highlights on the page. */
  highlight(
    layer: InspectorHighlightLayer,
    refs: readonly string[]
  ): Promise<void>;
  /**
   * Picks a Structural Ref among `refs` by pointing at the page; none when
   * Esc cancels or `signal` aborts.
   */
  pick(
    refs: readonly string[],
    signal: AbortSignal
  ): Promise<string | undefined>;
};

export function createInspectorClient(
  transport: InspectorContract
): InspectorClient {
  let held = emptyInspectorState;
  const listeners = new Set<() => void>();
  const imageListeners = new Set<(run: InspectorAgentImageRun) => void>();
  let stopTransport: (() => void) | undefined;
  let picks = 0;

  const take = (incoming: InspectorState) => {
    const next = mergeInspectorState(held, incoming);
    if (next === held) return;
    held = next;
    for (const listener of [...listeners]) listener();
  };

  const follow = () => {
    let following = true;
    const stop = transport.subscribe({
      onEvent(event) {
        if (event.type === "state") take(event.state);
        else for (const listener of [...imageListeners]) listener(event.run);
      },
      onError: (error) => console.warn(error.message),
    });
    // The state now, which a listener that came late has not been pushed.
    void transport
      .getState()
      .then((state) => following && take(state))
      .catch((error: unknown) =>
        console.warn(error instanceof Error ? error.message : String(error))
      );
    return () => {
      following = false;
      stop();
    };
  };

  return {
    current: () => held,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) stopTransport = follow();
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        stopTransport?.();
        stopTransport = undefined;
      };
    },
    onAgentImageRun(listener) {
      imageListeners.add(listener);
      return () => void imageListeners.delete(listener);
    },
    async runTool(request) {
      const result = await transport.runTool(request);
      take(result.state);
      return result;
    },
    async highlight(layer, refs) {
      take((await transport.highlight({ layer, refs })).state);
    },
    async pick(refs, signal) {
      if (signal.aborted) return undefined;
      const id = `pick-${++picks}`;
      const cancel = () => void transport.cancelPick({ id }).catch(() => {});
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await transport.pick({ id, refs });
        take(result.state);
        return result.ref;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}

let client: InspectorClient | undefined;

/**
 * The document's Inspector client, over the inline transport: the runtime's
 * own contract, called directly.
 */
export function inspectorClient(): InspectorClient {
  return (client ??= createInspectorClient(inlineInspectorContract()));
}

/**
 * Tests: serves the client from `transport` instead of the runtime's own
 * contract, which is how a test stands in a session.
 */
export function replaceInspectorTransport(transport: InspectorContract) {
  client = createInspectorClient(transport);
}

/** The newest state the document's client holds, kept current. */
export function useInspectorState(
  source: InspectorClient = inspectorClient()
): InspectorState {
  return useSyncExternalStore(source.subscribe, source.current);
}
