// The Inspector window a Session's process serves, whose socket speaks the
// frames of `webSocketInspectorContract` in @ayme-dev/inspector.
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Effect, Fiber, Stream } from "effect";
import { WebSocketServer, type WebSocket } from "ws";

import type { Session } from "../../session/application";
import {
  OPENING_CODE_LIFETIME_MS,
  type InspectorEvent,
} from "../../session/domain";
import {
  bringsToken,
  newToken,
  openingCodes,
  paramOf,
  withCodeFragment,
  withToken,
} from "./inspectorToken";
import { inspectorDocument } from "./inspectorDocument";

const PAGE_PATH = "/inspector";
const SCRIPT_PATH = "/inspector/external.mjs";
const SOCKET_PATH = "/inspector/ws";

/** How long closing waits for the windows to take their last frames, and
 * for what else is open: a window that does not read its socket is not
 * waited for. */
const FLUSH_LIMIT_MS = 1_000;

/** The largest frame a window may send: a request carries a method and a
 * tool's arguments, far below it, so a larger frame is not the
 * Inspector's. */
const MAX_REQUEST_BYTES = 1024 * 1024;

/** How much a window may leave unread before it is closed: it bounds what
 * the Session keeps for a window that stopped reading, well above the
 * largest state a window is sent. */
const MAX_UNREAD_BYTES = 16 * 1024 * 1024;

/** The close code of a frame that is no request (RFC 6455, 7.4.1). */
const NOT_A_REQUEST = 1008;

const page = (name: string) =>
  inspectorDocument(
    name,
    `<script type="module" src="${SCRIPT_PATH}"></script>`
  );

/** Whether a request names `host`, the address the server printed, and
 * comes from no page or from the window's own: a page that points a name
 * of its own at it, or a page of another origin, reads nothing, and a tab
 * of the window is always at the address the Session tells apart from its
 * Tabs (`showsWindow`). */
function isOwn(request: IncomingMessage, host: string): boolean {
  const { origin } = request.headers;
  if (request.headers.host !== host) return false;
  return origin === undefined || origin === `http://${host}`;
}

const pathOf = (request: IncomingMessage) => (request.url ?? "/").split("?")[0];

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string
) {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    // No page of another origin frames the window, to click its controls.
    "content-security-policy": "frame-ancestors 'none'",
  });
  response.end(body);
}

function requestIn(data: unknown):
  | {
      id: string | number;
      method: string;
      params?: unknown;
      tab?: number;
    }
  | undefined {
  try {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    const { id, method, tab } = frame;
    if (
      (typeof id === "string" || typeof id === "number") &&
      typeof method === "string" &&
      method !== ""
    )
      return {
        id,
        method,
        params: frame.params,
        ...(typeof tab === "number" && { tab }),
      };
  } catch {
    // Not JSON: no request.
  }
  return undefined;
}

function frameOf(event: InspectorEvent, listening: boolean) {
  if ("ended" in event) return { ended: event.ended, inChat: event.inChat };
  if ("tab" in event) return event;
  return listening ? { event: event.contract } : undefined;
}

/** The window of one Session, once served. */
export interface InspectorWindow {
  /** The window's page, such as `http://127.0.0.1:53124/inspector`. */
  readonly address: string;
  /** Where one `ayme inspect` opens the window: its page with a new
   * one-use code in the fragment, such as `…/inspector#code=…`. */
  opening(): string;
  /** The window's socket with the Session's token, which the Inspector an
   * Agent App shows in its chat connects to. */
  readonly agentAppSocket: string;
  /** Closes every window, once each took its last frames, then the
   * server. */
  close(): Promise<void>;
}

/**
 * Serves the Inspector window of the Session named `name` at a free port of
 * the loopback address: its page, the Inspector's built `script`, and a
 * socket for each window that brings the Session's token or a one-use code
 * (ADR-0072), from any origin; a window a code admitted is told the token
 * first, to connect again with. Each window hears the Session's events from when it
 * connects, the contract's own while it subscribed, and is closed once
 * told the Session ended. A window that connects before the Session
 * `started` waits for it.
 */
export async function serveInspectorWindow({
  name,
  script,
  started,
}: {
  readonly name: string;
  readonly script: string;
  readonly started: Effect.Effect<Pick<Session, "ask" | "events">>;
}): Promise<InspectorWindow> {
  const session = Effect.runPromise(started);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_REQUEST_BYTES,
  });
  const token = newToken();
  const codes = openingCodes(OPENING_CODE_LIFETIME_MS);
  let closing = false;
  // Set once the server listens, before it takes a request.
  let host = "";
  const server = createServer((request, response) => {
    const path = pathOf(request);
    if (closing) {
      response.shouldKeepAlive = false;
      return send(response, 503, "text/plain", "The Session is ending.");
    }
    if (!isOwn(request, host))
      return send(
        response,
        403,
        "text/plain",
        "Not a request to this address."
      );
    if (request.method !== "GET" && request.method !== "HEAD")
      return send(response, 405, "text/plain", "Only GET is served here.");
    if (path === PAGE_PATH || path === `${PAGE_PATH}/`)
      return send(response, 200, "text/html; charset=utf-8", page(name));
    if (path !== SCRIPT_PATH)
      return send(response, 404, "text/plain", "Not found.");
    readFile(script, "utf8").then(
      (body) => send(response, 200, "text/javascript; charset=utf-8", body),
      (error: unknown) =>
        send(
          response,
          503,
          "text/plain",
          `The Inspector's script could not be read: ${error instanceof Error ? error.message : String(error)}`
        )
    );
  });
  server.on("upgrade", (request, socket, head) => {
    if (closing) return socket.destroy();
    if (pathOf(request) !== SOCKET_PATH || request.headers.host !== host)
      return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    const code = paramOf(request, "code");
    // A code is taken here, before the upgrade, so no second client can
    // bring it while this one connects.
    if (code === null ? !bringsToken(request, token) : !codes.take(code))
      return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    sockets.handleUpgrade(request, socket, head, (ws) => {
      if (code !== null) ws.send(JSON.stringify({ token }));
      void session.then((attachedSession) => accept(ws, attachedSession));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const address = `http://${host}${PAGE_PATH}`;
  return {
    address,
    opening: () => withCodeFragment(address, codes.make()),
    agentAppSocket: withToken(`ws://${host}${SOCKET_PATH}`, token),
    close: async () => {
      closing = true;
      const closed = new Promise((resolve) => server.close(resolve));
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(
          [...sockets.clients].map((ws) => {
            const gone = new Promise((resolve) => ws.once("close", resolve));
            ws.close();
            return gone;
          })
        ),
        new Promise((resolve) => (timer = setTimeout(resolve, FLUSH_LIMIT_MS))),
      ]);
      clearTimeout(timer);
      for (const ws of sockets.clients) ws.terminate();
      server.closeAllConnections();
      sockets.close();
      await closed;
    },
  };
}

/** Carries the Inspector's contract between the window `ws` and
 * `session`, until the window closes or is told the Session ended. */
function accept(ws: WebSocket, session: Pick<Session, "ask" | "events">) {
  let listening = false;
  const reply = (frame: unknown) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_UNREAD_BYTES) return ws.terminate();
    ws.send(JSON.stringify(frame));
  };
  // A frame too large or not a WebSocket's ends this window alone: ws
  // closes it with the code that says why, and the error, heard here, does
  // not reach the process.
  ws.on("error", () => {});
  const hearing = Effect.runFork(
    Stream.runForEach(session.events, (event) =>
      Effect.sync(() => {
        const frame = frameOf(event, listening);
        if (frame) reply(frame);
        if ("ended" in event) ws.close();
      })
    )
  );
  // The reads it asked for are released with it; a Run it started goes on,
  // as one an agent started does.
  const reads = new Set<Fiber.Fiber<void>>();
  ws.once("close", () => {
    for (const fiber of [hearing, ...reads])
      void Effect.runFork(Fiber.interrupt(fiber));
  });
  ws.on("message", (data, isBinary) => {
    const request = isBinary ? undefined : requestIn(data);
    if (!request) return ws.close(NOT_A_REQUEST, "Not an Inspector request.");
    const { id, method, params, tab } = request;
    if (method === "subscribe" || method === "unsubscribe") {
      listening = method === "subscribe";
      return reply({ id, result: null });
    }
    const answering = session
      .ask({
        inspector: {
          contract: { method, params, ...(tab !== undefined && { tab }) },
        },
      })
      .pipe(
        Effect.map((answer) =>
          reply(
            answer.ok
              ? { id, result: answer.data ?? null }
              : { id, error: answer.text }
          )
        )
      );
    if (method === "runTool") return void Effect.runFork(answering);
    const read = Effect.runFork(answering);
    reads.add(read);
    read.addObserver(() => reads.delete(read));
  });
}
