import type { InspectorPort } from "@ayme-dev/mcp/client";

import type { InspectorContract } from "../shared";

/**
 * The page's Inspector contract (ADR-0049) as plain data for the Agent
 * Connection to relay: a request names a contract method and carries its
 * argument, and the answer and the events are the contract's own. This is
 * how the runtime serves an Inspector outside the page; the contract does
 * not know it is called this way.
 *
 * Each request calls the contract before it returns, so requests start in
 * the order they arrive: a `cancelPick` finds the `pick` it cancels.
 * Stopping the events ends what the window asked for in the page: its
 * highlights and its Demo Mode request.
 */
export function inspectorChannelPort(
  contract: InspectorContract
): InspectorPort {
  const commands: Record<string, (params: never) => Promise<unknown>> = {
    getState: () => contract.getState(),
    runTool: (params) => contract.runTool(params),
    highlight: (params) => contract.highlight(params),
    pick: (params) => contract.pick(params),
    cancelPick: (params) => contract.cancelPick(params),
    look: () => contract.look(),
    recordedPageState: () => contract.recordedPageState(),
    demo: (params) => contract.demo(params),
    pomDefinitionText: (params) => contract.pomDefinitionText(params),
  };
  return {
    request(method, params) {
      const command = Object.hasOwn(commands, method)
        ? commands[method]
        : undefined;
      if (!command)
        return Promise.reject(
          new Error(`The Inspector contract has no "${method}".`)
        );
      return command(params as never);
    },
    subscribe(listener) {
      const stop = contract.subscribe({
        onEvent: listener,
        onError: () => {},
      });
      return () => {
        stop();
        // The window that asked is gone.
        void contract.highlight({ layer: "hover", refs: [] }).catch(() => {});
        void contract.highlight({ layer: "pinned", refs: [] }).catch(() => {});
        void contract.demo({ on: false }).catch(() => {});
      };
    },
  };
}
