import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";

import {
  DISCONNECTED_CLOSE_CODE,
  PageWelcomeSchema,
  ToolCallSchema,
  UNKNOWN_PAIRING_CLOSE_CODE,
  type PageTool,
  type PageWelcome,
} from "../../contract";
import type { PageChannel } from "../application/behaviours";
import type { PageChannelRouter } from "./pageChannelRouter";

/**
 * Opens the channel to the server at `url`, read at every (re)connect (its
 * address and token). Each time the socket opens, the page says hello with
 * `tab` and its URL, and `onWelcome` gets the server's reply; when the
 * socket reopens, it reports its tools again. When the server says another
 * tab paired in its place, or that it does not know the pairing, the
 * channel closes for good and `onDisconnected` or `onUnknownPairing` runs.
 */
export function openPageChannel(
  url: () => string,
  {
    tab,
    onWelcome,
    onDisconnected,
    onUnknownPairing,
  }: {
    tab: string;
    onWelcome(welcome: PageWelcome): void;
    onDisconnected(): void;
    onUnknownPairing(): void;
  }
): PageChannel {
  // The tools last reported, which a reopened socket reports again: the
  // server pairs each socket afresh.
  let reported: PageTool[] | undefined;
  let opened = false;
  const socket = createWSClient({
    url,
    onOpen() {
      const reopened = opened;
      opened = true;
      void client.hello
        .mutate({ tab, url: window.location.href })
        .then((welcome) => {
          onWelcome(PageWelcomeSchema.parse(welcome));
          if (reopened && reported) return client.publishTools.mutate(reported);
        })
        // The channel closed before the hello went out.
        .catch(() => {});
    },
    onClose(cause) {
      const code = cause?.code;
      if (
        code !== DISCONNECTED_CLOSE_CODE &&
        code !== UNKNOWN_PAIRING_CLOSE_CODE
      )
        return;
      // Closing here stops the client from reconnecting.
      void socket.close();
      if (code === DISCONNECTED_CLOSE_CODE) onDisconnected();
      else onUnknownPairing();
    },
  });
  const client = createTRPCClient<PageChannelRouter>({
    links: [wsLink({ client: socket })],
  });
  return {
    async publishTools(tools) {
      reported = [...tools];
      await client.publishTools.mutate(reported);
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
