import { createServer, type Server } from "node:http";

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
import {
  pageChannelRouter,
  type PageChannelContext,
} from "./pageChannelRouter";

/**
 * The WebSocket server pages and App Processes connect to. It accepts a
 * connection on the path `/<token>`, or without a token from a page on
 * localhost or a local process (see `admit`), and each accepted connection
 * attaches to `connection` once it says hello: as the page, or as an App
 * Process beside it. A `/probe` connection is closed at once and never
 * attaches. Returns the HTTP server, not yet listening, and what
 * closes it with every page connection, answering the calls still waiting.
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
        })
      );
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
 * An accepted connection: the page or App Process attaches to `connection`
 * when it says hello and detaches when its socket closes. A page another
 * tab replaced, or one that connected without a token while the server is
 * busy with another tab, is closed with `DISCONNECTED_CLOSE_CODE`. Only a
 * connection `fromProcess`, which sent no `Origin`, may say hello as an App
 * Process, and the server is never too busy for it. One that connected
 * without a token gets `handOver`, the server's token, in reply to its
 * hello.
 */
function acceptPage(
  connection: AgentConnection,
  ws: WebSocket,
  {
    handOver,
    fromProcess,
  }: { handOver: string | undefined; fromProcess: boolean }
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
      const welcome = handOver === undefined ? {} : { token: handOver };
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
          "This Ayme MCP server works with another tab; open its connect link to move it here."
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
