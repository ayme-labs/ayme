import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";

import { ToolCallSchema } from "../../contract";
import type { PageChannel } from "../application/behaviours";
import type { PageChannelRouter } from "./pageChannelRouter";

/** Opens the channel to the server at `url` (its address and token). */
export function openPageChannel(url: string): PageChannel {
  const socket = createWSClient({ url });
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
    close() {
      void socket.close();
    },
  };
}
