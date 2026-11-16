import type { ClientBehaviour } from "../../connection";
import type { InspectorResponse } from "../../contract";

/**
 * Serves the page's Inspector contract to external Inspector windows
 * through the server: runs each request the server relays on the page's
 * Inspector port, in the order they were made, and pushes the port's events
 * from `subscribe` until `unsubscribe` or until the channel closes. Does
 * nothing for a session that serves no external Inspector.
 */
export const serveInspector: ClientBehaviour = ({ channel, inspector }) => {
  if (!inspector) return () => {};
  let stopEvents: (() => void) | undefined;
  const succeeded = (id: string, result: unknown): InspectorResponse => ({
    id,
    ok: true,
    result: result ?? null,
  });
  const failed = (id: string, error: unknown): InspectorResponse => ({
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  const stopServing = channel.serveInspector(async ({ id, method, params }) => {
    if (method === "subscribe") {
      stopEvents ??= inspector.subscribe(
        (event) =>
          void channel
            .sendInspectorEvent(event)
            // The channel closed; the next channel is asked to subscribe again.
            .catch(() => {})
      );
      return succeeded(id, null);
    }
    if (method === "unsubscribe") {
      stopEvents?.();
      stopEvents = undefined;
      return succeeded(id, null);
    }
    try {
      return succeeded(id, await inspector.request(method, params));
    } catch (error) {
      return failed(id, error);
    }
  });
  return () => {
    stopServing();
    stopEvents?.();
    stopEvents = undefined;
  };
};
