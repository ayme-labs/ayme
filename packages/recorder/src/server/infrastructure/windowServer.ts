import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";

import { RecorderStartError } from "../../session/domain";
import {
  windowChannelRouter,
  type Subscriptions,
  type WindowTarget,
} from "./windowChannelRouter";

export type { WindowTarget } from "./windowChannelRouter";

/** The recorder window's server, listening at `url`. */
export type WindowServer = {
  /** The window's local address, such as `http://127.0.0.1:53124/`. */
  readonly url: string;
  /** Hands it the started recorder. A window that connects before waits. */
  attach(target: WindowTarget): void;
  /** Closes every window's channel, then the server. */
  close(): Promise<void>;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The path of the window's channel, beside its files. */
const CHANNEL_PATH = "/channel";

/** How long closing waits for a window's subscription to send what it
 * still owes: a window that does not read its socket is not waited for. */
const FLUSH_LIMIT_MS = 1_000;

/** Whether a request is made to the loopback address the server is on, so
 * that a page which points a name of its own at it reads nothing. */
function isLoopback(request: IncomingMessage): boolean {
  const { host, origin } = request.headers;
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host ?? "")) return false;
  return origin === undefined || origin === `http://${host}`;
}

/** The file a request's path names inside `folder`, or null when it names
 * none there. */
function fileFor(folder: string, url: string | undefined): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url ?? "/", "http://window").pathname);
  } catch {
    return null;
  }
  const file = resolve(folder, `.${path === "/" ? "/index.html" : path}`);
  return file.startsWith(folder + sep) ? file : null;
}

/**
 * Serves the recorder window on plain Node `http` and `ws`, at a free port
 * of the loopback address: the window's built files from `folder`, and its
 * tRPC channel over a WebSocket. Only starting can fail: a server that
 * cannot listen is a start error.
 */
export async function serveWindow(folder: string): Promise<WindowServer> {
  const root = resolve(folder);
  let attach!: (target: WindowTarget) => void;
  const target = new Promise<WindowTarget>((resolve) => (attach = resolve));
  let close!: () => void;
  const subscriptions: Subscriptions = {
    closing: new Promise((resolve) => (close = resolve)),
    open: new Set(),
  };

  const server = createServer((request, response) => {
    const file = isLoopback(request) ? fileFor(root, request.url) : undefined;
    if (file === undefined) {
      response.statusCode = 403;
      response.end("Not a loopback request.");
      return;
    }
    const send = (status: number, type: string, body: string | Buffer) => {
      response.statusCode = status;
      response.setHeader("content-type", type);
      response.end(body);
    };
    if (file === null) return send(404, "text/plain", "Not found.");
    readFile(file).then(
      (body) =>
        send(
          200,
          CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          body
        ),
      () => send(404, "text/plain", "Not found.")
    );
  });
  const sockets = new WebSocketServer({ noServer: true });
  const handleConnection = getWSConnectionHandler({
    wss: sockets,
    router: windowChannelRouter,
    createContext: () => ({ target, subscriptions }),
  });
  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://window").pathname;
    if (!isLoopback(request) || path !== CHANNEL_PATH) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      handleConnection(ws, request)
    );
  });

  await new Promise<void>((listening, failed) => {
    server.once("error", (cause) =>
      failed(
        new RecorderStartError(
          "port-in-use",
          `The recorder window could not be served. ${cause.message}`
        )
      )
    );
    server.listen(0, "127.0.0.1", listening);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    attach,
    async close() {
      // Every window is told the last update first: how the recorder ended.
      close();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(subscriptions.open),
        new Promise((resolve) => (timer = setTimeout(resolve, FLUSH_LIMIT_MS))),
      ]);
      clearTimeout(timer);
      await new Promise<void>((closed) => {
        // Closed, not cut: what was sent still arrives.
        for (const ws of sockets.clients) ws.close(1001, "The recorder ended.");
        sockets.close();
        server.close(() => closed());
        server.closeAllConnections();
      });
    },
  };
}
