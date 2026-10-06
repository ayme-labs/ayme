import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";

import {
  DISCONNECTED_CLOSE_CODE,
  PageToolListSchema,
  PageWelcomeSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
  ToolReportAnswerSchema,
  UNKNOWN_PAIRING_CLOSE_CODE,
  type Hello,
  type PageTool,
  type PageWelcome,
} from "../../contract";
import type { PageChannel } from "../application/behaviours";
import type { PageChannelRouter } from "./pageChannelRouter";

/**
 * Opens the channel to the server at `url`, read at every (re)connect (its
 * address and token). Each time the socket opens, it says `hello()`, and
 * `onWelcome` gets the server's reply; when the socket reopens, it reports
 * its tools again. When the server says another tab paired in its place,
 * or that it does not know the pairing, the channel closes for good and
 * `onDisconnected` or `onUnknownPairing` runs. On any other close the
 * channel reconnects by itself, unless `onClose` is given: then it closes
 * for good and `onClose` runs, as for an App Process, which looks for a
 * server again.
 */
export function openPageChannel(
  url: () => string,
  {
    hello,
    onWelcome,
    onDisconnected,
    onUnknownPairing,
    onClose,
    WebSocket: WebSocketClass,
  }: {
    hello(): Hello;
    /** The WebSocket class to connect with; the global one unless given. */
    WebSocket?: typeof WebSocket;
    onWelcome(welcome: PageWelcome): void;
    onDisconnected(): void;
    onUnknownPairing(): void;
    onClose?(): void;
  }
): PageChannel {
  // The tools last reported, which a reopened socket reports again: the
  // server pairs each socket afresh.
  let reported: PageTool[] | undefined;
  let opened = false;
  // Who follows the App Processes' tools: they hear of none once the
  // socket closes, and the subscription gives them again once it reopens.
  const processToolListeners = new Set<(tools: readonly PageTool[]) => void>();
  const socket = createWSClient({
    url,
    ...(WebSocketClass ? { WebSocket: WebSocketClass } : {}),
    onOpen() {
      const reopened = opened;
      opened = true;
      void client.hello
        .mutate(hello())
        .then((welcome) => {
          onWelcome(PageWelcomeSchema.parse(welcome));
          if (reopened && reported) return client.publishTools.mutate(reported);
        })
        // The channel closed before the hello went out.
        .catch(() => {});
    },
    onClose(cause) {
      for (const listener of processToolListeners) listener([]);
      const code = cause?.code;
      const known =
        code === DISCONNECTED_CLOSE_CODE || code === UNKNOWN_PAIRING_CLOSE_CODE;
      if (!known && !onClose) return;
      // Closing here stops the client from reconnecting.
      void socket.close();
      if (code === DISCONNECTED_CLOSE_CODE) onDisconnected();
      else if (code === UNKNOWN_PAIRING_CLOSE_CODE) onUnknownPairing();
      else onClose?.();
    },
  });
  const client = createTRPCClient<PageChannelRouter>({
    links: [wsLink({ client: socket })],
  });
  return {
    async publishTools(tools) {
      reported = [...tools];
      // A server from before App Processes answers nothing.
      return ToolReportAnswerSchema.parse(
        (await client.publishTools.mutate(reported)) ?? {}
      );
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
    followProcessTools(listener) {
      processToolListeners.add(listener);
      const subscription = client.processTools.subscribe(undefined, {
        onData(data) {
          listener(PageToolListSchema.parse(data));
        },
        // A server from before App Processes has no such subscription: the
        // page hears of no App Process tools.
        onError() {},
      });
      return () => {
        processToolListeners.delete(listener);
        subscription.unsubscribe();
      };
    },
    async callProcessTool(name, input) {
      return ToolCallOutcomeSchema.parse(
        await client.callProcessTool.mutate({ name, input })
      );
    },
    close() {
      void socket.close();
    },
  };
}
