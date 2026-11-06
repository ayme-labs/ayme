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
 * Stopping the last window's events ends what the windows asked for in the
 * page: their highlights, their Demo Mode request and a pick still waiting
 * for a click, whose input blockers would otherwise stay in the page.
 */
export function inspectorChannelPort(
  contract: InspectorContract
): InspectorPort {
  // The picks that have not answered or been cancelled, and the windows
  // listening: a pick outlives one window while another still listens.
  const picking = new Set<string>();
  let listening = 0;
  const commands: Record<string, (params: never) => Promise<unknown>> = {
    getState: () => contract.getState(),
    runTool: (params) => contract.runTool(params),
    highlight: (params) => contract.highlight(params),
    pick: (params) => {
      const { id } = params as { id: string };
      picking.add(id);
      return contract.pick(params).finally(() => picking.delete(id));
    },
    cancelPick: (params) => {
      picking.delete((params as { id: string }).id);
      return contract.cancelPick(params);
    },
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
      listening++;
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        listening--;
        stop();
        if (listening === 0)
          for (const id of picking)
            void contract.cancelPick({ id }).catch(() => {});
        // The window that asked is gone.
        void contract.highlight({ layer: "hover", refs: [] }).catch(() => {});
        void contract.highlight({ layer: "pinned", refs: [] }).catch(() => {});
        void contract.demo({ on: false }).catch(() => {});
      };
    },
  };
}
