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
  type PageWelcome,
} from "../../contract";
import { admit, busyRefuses, isLocalProcess, probeAnswer } from "../../pairing";
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
 * Process beside it. A `/probe` connection is closed at once and never
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
 * hello, and every one gets `imageFolder` and the agent's name.
 */
function acceptPage(
  connection: AgentConnection,
  ws: WebSocket,
  {
    handOver,
    fromProcess,
    imageFolder,
    agent,
  }: {
    handOver: string | undefined;
    fromProcess: boolean;
    imageFolder: string | undefined;
    agent: () => string | undefined;
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
