import { createServer, type Server } from "node:http";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer, type WebSocket } from "ws";

import { SERVER_IDENTITY, admit } from "../../pairing";
import type {
  AgentConnection,
  PageSession,
} from "../application/agentConnection";
import { pageChannelRouter } from "./pageChannelRouter";

/**
 * The WebSocket server pages connect to. It accepts a connection on the
 * path `/<token>`, or without a token from a page on localhost (see
 * `admit`), and each accepted connection is a page attached to
 * `connection`. Returns the HTTP server, not yet listening, and what closes
 * it with every page connection.
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
  const pages = new WeakMap<WebSocket, PageSession>();
  const handleConnection = getWSConnectionHandler({
    wss: sockets,
    router: pageChannelRouter,
    createContext: ({ res }) => ({ page: pages.get(res)! }),
  });

  server.on("upgrade", (request, socket, head) => {
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
      sockets.handleUpgrade(request, socket, head, (ws) =>
        ws.close(SERVER_IDENTITY.code, SERVER_IDENTITY.reason)
      );
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const page = connection.attach();
      pages.set(ws, page);
      ws.once("close", () => connection.detach(page));
      handleConnection(ws, request);
    });
  });
  return {
    server,
    close() {
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      server.close();
    },
  };
}
