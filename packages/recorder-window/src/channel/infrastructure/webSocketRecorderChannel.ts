import { createTRPCUntypedClient, createWSClient, wsLink } from "@trpc/client";
import type {
  CommandResult,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";

import type { RecorderChannel } from "../application/recorderChannel";

/**
 * The channel to the recorder that serves this window, over tRPC on a
 * WebSocket at `url`. The window knows the engine only through its
 * contract: the mutation `send` and the subscription `updates`. A socket
 * that drops is opened again, and the subscription with it, which gives the
 * full state again.
 */
export function openRecorderChannel(url: string): RecorderChannel {
  const socket = createWSClient({
    url,
    // The server is on loopback: trying again soon costs nothing.
    retryDelayMs: () => 500,
  });
  const client = createTRPCUntypedClient({
    links: [wsLink({ client: socket })],
  });
  return {
    send: (command) =>
      client.mutation("send", command) as Promise<CommandResult>,
    subscribe(listener) {
      const subscription = client.subscription("updates", undefined, {
        onData: (update) => listener(update as RecorderUpdate),
      });
      return () => subscription.unsubscribe();
    },
  };
}
