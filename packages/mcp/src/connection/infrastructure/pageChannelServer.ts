import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer, type WebSocket } from "ws";

import {
  DISCONNECTED_CLOSE_CODE,
  UNKNOWN_PAIRING_CLOSE_CODE,
  VERSION_GAP_CLOSE_CODE,
  type PageWelcome,
} from "../../contract";
import {
  OUR_AYME,
  admit,
  busyRefuses,
  isLocalProcess,
  probeAnswer,
  versionGap,
  type AymeVersion,
} from "../../pairing";
import type {
  AgentConnection,
  PageSession,
  ProcessSession,
} from "../application/agentConnection";
import { pageWelcome } from "../domain/welcome";
import {
  pageChannelRouter,
  type PageChannelContext,
} from "./pageChannelRouter";

/**
 * What else the server's HTTP server answers: each method returns whether it
 * claimed the request or upgrade, and `close` ends what it holds.
 */
export type ServerExtension = {
  request(request: IncomingMessage, response: ServerResponse): boolean;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  close(): void;
};

/**
 * The WebSocket server pages and App Processes connect to. It accepts a
 * connection on the path `/<token>`, or without a token from a page on
 * localhost or a local process (see `admit`), and each accepted connection
 * attaches to `connection` once it says hello: as the page, or as an App
 * Process beside it. A page whose Ayme speaks another pairing contract than
 * `ayme`, this package's unless given, is refused (see `versionGap`). A `/probe` connection is closed at once and never
 * attaches. `extensions` let something else answer the HTTP requests and
 * WebSocket upgrades one of them claims, in order, such as the external
 * Inspector's page; everything else is the channel's. Returns the HTTP server, not yet
 * listening, and what closes it with every page connection, answering the
 * calls still waiting.
 */
export function createPageChannelServer({
  connection,
  token,
  imageFolder,
  agent,
  extensions = [],
  ayme = OUR_AYME,
}: {
  connection: AgentConnection;
  token: string;
  /** Where the server saves a tool's images, which a page's welcome names. */
  imageFolder?: string;
  /**
   * The name the agent's MCP client introduced itself with, if it has,
   * read at each hello, which the page's welcome names.
   */
  agent: () => string | undefined;
  extensions?: readonly ServerExtension[];
  /** The server's Ayme, which a page's must work with. */
  ayme?: Required<AymeVersion>;
}): { server: Server; close(): void } {
  const server = createServer((request, response) => {
    if (extensions.some((extension) => extension.request(request, response)))
      return;
    response.statusCode = 426;
    response.end("The Ayme MCP server accepts WebSocket connections only.");
  });
  const sockets = new WebSocketServer({ noServer: true });
  const pages = new WeakMap<WebSocket, PageChannelContext["page"]>();
  const handleConnection = getWSConnectionHandler({
    wss: sockets,
    router: pageChannelRouter,
    createContext: ({ res }) => ({ connection, page: pages.get(res)! }),
  });

  server.on("upgrade", (request, socket, head) => {
    if (
      extensions.some((extension) => extension.upgrade(request, socket, head))
    )
      return;
    const admission = admit({
      path: request.url ?? "",
      origin: request.headers.origin,
      token,
    });
    if (admission === "refused") {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    if (admission === "probe") {
      const { code, reason } = probeAnswer({
        busyWith: connection.busyWith,
        origin: request.headers.origin,
      });
      sockets.handleUpgrade(request, socket, head, (ws) =>
        ws.close(code, reason)
      );
      return;
    }
    if (admission === "unknownPairing") {
      sockets.handleUpgrade(request, socket, head, (ws) =>
        ws.close(
          UNKNOWN_PAIRING_CLOSE_CODE,
          "This Ayme MCP server does not know this pairing."
        )
      );
      return;
    }
    const tokenless = admission === "tokenless";
    const fromProcess = isLocalProcess(request.headers.origin);
    sockets.handleUpgrade(request, socket, head, (ws) => {
      pages.set(
        ws,
        acceptPage(connection, ws, {
          handOver: tokenless ? token : undefined,
          fromProcess,
          imageFolder,
          agent,
          ayme,
        })
      );
      handleConnection(ws, request);
    });
  });
  return {
    server,
    close() {
      for (const extension of extensions) extension.close();
      connection.close();
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      server.close();
    },
  };
}

/**
 * An accepted connection: the page or App Process attaches to `connection`
 * when it says hello and detaches when its socket closes. A page another
 * tab replaced, or one that connected without a token while the server is
 * busy with another tab, is closed with `DISCONNECTED_CLOSE_CODE`. Only a
 * connection `fromProcess`, which sent no `Origin`, may say hello as an App
 * Process, and the server is never too busy for it. One that connected
 * without a token gets `handOver`, the server's token, in reply to its
 * hello, and every one gets `imageFolder` and the agent's name. A page
 * whose Ayme can't work with the server's `ayme` is closed with
 * `VERSION_GAP_CLOSE_CODE` and the gap as the reason, and `connection`
 * records the gap for the agent.
 */
function acceptPage(
  connection: AgentConnection,
  ws: WebSocket,
  {
    handOver,
    fromProcess,
    imageFolder,
    agent,
    ayme,
  }: {
    handOver: string | undefined;
    fromProcess: boolean;
    imageFolder: string | undefined;
    agent: () => string | undefined;
    ayme: Required<AymeVersion>;
  }
): PageChannelContext["page"] {
  let page: PageSession | ProcessSession | undefined;
  let resolveSession!: (page: PageSession | ProcessSession) => void;
  let rejectSession!: (error: Error) => void;
  const session = new Promise<PageSession | ProcessSession>(
    (resolve, reject) => {
      resolveSession = resolve;
      rejectSession = reject;
    }
  );
  // Procedures waiting for a page that never said hello end with the socket.
  session.catch(() => {});
  const disconnect = () =>
    ws.close(
      DISCONNECTED_CLOSE_CODE,
      "Another tab connected to this Ayme MCP server."
    );
  ws.once("close", () => {
    if (page) connection.detach(page);
    rejectSession(new Error("The page's channel closed."));
  });
  return {
    session,
    hello(hello): PageWelcome {
      if (page) return {};
      const welcome = pageWelcome({
        token: handOver,
        imageFolder,
        agent: agent(),
      });
      if ("process" in hello) {
        if (!fromProcess) {
          ws.close(1008, "Only a local process pairs as an App Process.");
          return {};
        }
        page = connection.attachProcess(hello);
        resolveSession(page);
        return welcome;
      }
      const gap = versionGap({ page: hello, server: ayme });
      if (gap !== undefined) {
        connection.refuseVersion(gap);
        ws.close(VERSION_GAP_CLOSE_CODE, closeReason(gap));
        return {};
      }
      // Decided at hello, which names the tab, so the tab the server works
      // with may still connect without a token, as before its token
      // reached it.
      if (
        handOver !== undefined &&
        busyRefuses({ busyWith: connection.busyWith, tab: hello.tab })
      ) {
        ws.close(
          DISCONNECTED_CLOSE_CODE,
          "This Ayme MCP server works with another tab."
        );
        return {};
      }
      page = connection.attach(hello, disconnect);
      if (!page) return {};
      resolveSession(page);
      return welcome;
    },
  };
}

/** `text` cut to the 123 bytes a WebSocket close reason holds. */
function closeReason(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= 123) return text;
  return new TextDecoder().decode(bytes.slice(0, 123)).replace(/\uFFFD$/, "");
}
