import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";

import {
  DISCONNECTED_CLOSE_CODE,
  HiddenToolListSchema,
  PageToolListSchema,
  PageWelcomeSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
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
 * channel reconnects by itself, and `onLost` runs, unless `onClose` is
 * given: then it closes for good and `onClose` runs, as for an App
 * Process, which looks for a server again. A channel closed for good sends
 * nothing more, so it never says hello again in place of the channel that
 * replaced it.
 */
export function openPageChannel(
  url: () => string,
  {
    hello,
    onWelcome,
    onDisconnected,
    onUnknownPairing,
    onLost,
    onClose,
    WebSocket: WebSocketClass,
  }: {
    hello(): Hello;
    /** The WebSocket class to connect with; the global one unless given. */
    WebSocket?: typeof WebSocket;
    onWelcome(welcome: PageWelcome): void;
    onDisconnected(): void;
    onUnknownPairing(): void;
    onLost?(): void;
    onClose?(): void;
  }
): PageChannel {
  // The tools last reported, which a reopened socket reports again: the
  // server pairs each socket afresh.
  let reported: PageTool[] | undefined;
  let opened = false;
  let closed = false;
  let imageFolder: string | undefined;
  // Who follows the App Processes' tools: they hear of none once the
  // socket closes, and the subscription gives them again once it reopens.
  const processToolListeners = new Set<(tools: readonly PageTool[]) => void>();
  const socket = createWSClient({
    url,
    // The server is on loopback, so retrying often costs nothing, and a tab
    // pairs again soon after its server restarts (tRPC's default backs off
    // to 30 s).
    retryDelayMs: (attempt) => Math.min(500 * attempt, 2000),
    ...(WebSocketClass ? { WebSocket: WebSocketClass } : {}),
    onOpen() {
      const reopened = opened;
      opened = true;
      void client.hello
        .mutate(hello())
        .then((welcome) => {
          const parsed = PageWelcomeSchema.parse(welcome);
          imageFolder = parsed.imageFolder;
          onWelcome(parsed);
          if (reopened && reported && !sendAtOnce("publishTools", reported))
            return client.publishTools.mutate(reported);
        })
        // The channel closed before the hello went out.
        .catch(() => {});
    },
    onClose(cause) {
      for (const listener of processToolListeners) listener([]);
      const code = cause?.code;
      const known =
        code === DISCONNECTED_CLOSE_CODE || code === UNKNOWN_PAIRING_CLOSE_CODE;
      if (!known && !onClose) return onLost?.();
      // Closing here stops the client from reconnecting.
      closed = true;
      void socket.close();
      if (code === DISCONNECTED_CLOSE_CODE) onDisconnected();
      else if (code === UNKNOWN_PAIRING_CLOSE_CODE) onUnknownPairing();
      else onClose?.();
    },
  });
  const client = createTRPCClient<PageChannelRouter>({
    links: [wsLink({ client: socket })],
  });
  // tRPC reopens a closed socket for its next request. A call that ends
  // after the channel closed would answer on a reopened socket, which says
  // hello as the tab's page in place of the channel that replaced this one,
  // and the server would send the tab's calls where none runs them (#968).
  const live = () => {
    if (closed)
      throw new Error("The channel to the Ayme MCP server is closed.");
    return client;
  };
  // The tRPC client sends a request in a later task, to batch it with
  // others. A document that started loading another may unload before that
  // task runs, and what it said would be lost (#578). So an answer and the
  // navigating report go out on the open socket at once, in tRPC's own message
  // format, under an id no tRPC request uses; the client ignores the reply.
  // The router has no transformer, so the input goes as it is. The tools go
  // the same way, so a change a call made reaches the server before its
  // answer.
  const sendAtOnce = (
    path: "publishTools" | "answer" | "navigating",
    input: unknown
  ) => {
    const { connection } = socket;
    if (closed || connection?.state !== "open") return false;
    connection.ws.send(
      JSON.stringify({
        id: path,
        method: "mutation",
        params: { path, input },
      })
    );
    return true;
  };
  return {
    get imageFolder() {
      return imageFolder;
    },
    async publishTools(tools) {
      reported = [...tools];
      if (!sendAtOnce("publishTools", reported))
        await live().publishTools.mutate(reported);
    },
    answerCalls(handler) {
      const subscription = live().calls.subscribe(undefined, {
        onData(data) {
          const call = ToolCallSchema.parse(data);
          void handler(call)
            .then((outcome) => {
              if (!sendAtOnce("answer", outcome))
                return live().answer.mutate(outcome);
            })
            // The channel closed before the answer went out.
            .catch(() => {});
        },
      });
      return () => subscription.unsubscribe();
    },
    async reportNavigating(navigating) {
      if (!sendAtOnce("navigating", navigating))
        await live().navigating.mutate(navigating);
    },
    followProcessTools(listener) {
      processToolListeners.add(listener);
      const subscription = live().processTools.subscribe(undefined, {
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
    followHiddenTools(listener) {
      const subscription = live().hiddenTools.subscribe(undefined, {
        onData(data) {
          listener(HiddenToolListSchema.parse(data));
        },
        // A server from before App Processes has no such subscription.
        onError() {},
      });
      return () => subscription.unsubscribe();
    },
    async callProcessTool(name, input) {
      return ToolCallOutcomeSchema.parse(
        await live().callProcessTool.mutate({ name, input })
      );
    },
    close() {
      closed = true;
      void socket.close();
    },
  };
}
