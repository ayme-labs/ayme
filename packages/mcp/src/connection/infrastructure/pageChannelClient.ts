import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";

import { DISCONNECTED_CLOSE_CODE, ToolCallSchema } from "../../contract";
import type { PageChannel } from "../application/behaviours";
import type { PageChannelRouter } from "./pageChannelRouter";

/**
 * Opens the channel to the server at `url` (its address and token). Each
 * time the socket opens, the page says hello with `tab` and its URL. When
 * the server says another tab paired in its place, the channel closes for
 * good and `onDisconnected` runs.
 */
export function openPageChannel(
  url: string,
  { tab, onDisconnected }: { tab: string; onDisconnected(): void }
): PageChannel {
  const socket = createWSClient({
    url,
    onOpen() {
      void client.hello
        .mutate({ tab, url: window.location.href })
        // The channel closed before the hello went out.
        .catch(() => {});
    },
    onClose(cause) {
      if (cause?.code !== DISCONNECTED_CLOSE_CODE) return;
      // Closing here stops the client from reconnecting.
      void socket.close();
      onDisconnected();
    },
  });
  const client = createTRPCClient<PageChannelRouter>({
    links: [wsLink({ client: socket })],
  });
  return {
    async publishTools(tools) {
      await client.publishTools.mutate([...tools]);
    },
    answerCalls(handler) {
      const subscription = client.calls.subscribe(undefined, {
        onData(data) {
          const call = ToolCallSchema.parse(data);
          void handler(call)
            .then((outcome) => client.answer.mutate(outcome))
            // The channel closed before the answer went out.
            .catch(() => {});
        },
      });
      return () => subscription.unsubscribe();
    },
    async reportLeaving(leaving) {
      await client.leaving.mutate(leaving);
    },
    close() {
      void socket.close();
    },
  };
}
