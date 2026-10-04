import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer, type WebSocket } from "ws";

import { DISCONNECTED_CLOSE_CODE } from "../../contract";
import type {
  AgentConnection,
  PageSession,
} from "../application/agentConnection";
import {
  pageChannelRouter,
  type PageChannelContext,
} from "./pageChannelRouter";

/**
 * The WebSocket server pages connect to. It accepts a connection only on the
 * path `/<token>`, and each accepted connection is a page that attaches to
 * `connection` once it says hello. Returns the HTTP server, not yet
 * listening, and what closes it with every page connection, answering the
 * calls still waiting.
 */
export function createPageChannelServer({
  connection,
  token,
}: {
  connection: AgentConnection;
  token: string;
}): { server: Server; close(): void } {
  const server = createServer((_request, response) => {
    response.statusCode = 426;
    response.end("The Ayme MCP server accepts WebSocket connections only.");
  });
  const sockets = new WebSocketServer({ noServer: true });
  const pages = new WeakMap<WebSocket, PageChannelContext["page"]>();
  const handleConnection = getWSConnectionHandler({
    wss: sockets,
    router: pageChannelRouter,
    createContext: ({ res }) => ({ page: pages.get(res)! }),
  });
  const expected = Buffer.from(`/${token}`);

  server.on("upgrade", (request, socket, head) => {
    const path = Buffer.from(request.url ?? "");
    if (path.length !== expected.length || !timingSafeEqual(path, expected)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      pages.set(ws, acceptPage(connection, ws));
      handleConnection(ws, request);
    });
  });
  return {
    server,
    close() {
      connection.close();
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      server.close();
    },
  };
}

/**
 * An accepted page connection: the page attaches to `connection` when it
 * says hello and detaches when its socket closes. A page another tab
 * replaced is closed with `DISCONNECTED_CLOSE_CODE`.
 */
function acceptPage(
  connection: AgentConnection,
  ws: WebSocket
): PageChannelContext["page"] {
  let page: PageSession | undefined;
  let resolveSession!: (page: PageSession) => void;
  let rejectSession!: (error: Error) => void;
  const session = new Promise<PageSession>((resolve, reject) => {
    resolveSession = resolve;
    rejectSession = reject;
  });
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
    hello(hello) {
      if (page) return;
      page = connection.attach(hello, disconnect);
      if (page) resolveSession(page);
    },
  };
}
