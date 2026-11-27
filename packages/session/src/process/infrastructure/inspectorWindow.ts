// The Inspector window a Session's process serves: the page that loads the
// Inspector's external build, and a WebSocket per window that carries the
// Inspector's contract between the window and the Session. The window
// talks in the frames the Inspector's transport sends and reads
// (`webSocketInspectorContract` in @ayme-dev/inspector).
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { WebSocketServer, type WebSocket } from "ws";

import type { Session } from "../../session/application";
import type { InspectorEvent } from "../../session/domain";
import {
  bringsToken,
  newToken,
  withToken,
  withTokenFragment,
} from "./inspectorToken";
import { inspectorDocument } from "./inspectorDocument";

const PAGE_PATH = "/inspector";
const SCRIPT_PATH = "/inspector/external.mjs";
const SOCKET_PATH = "/inspector/ws";

/** How long closing waits for each window to take its last frames: a
 * window that does not read its socket is not waited for. */
const FLUSH_LIMIT_MS = 1_000;

/** The window's page, which names the Session `name`. */
const page = (name: string) =>
  inspectorDocument(
    name,
    `<script type="module" src="${SCRIPT_PATH}"></script>`
  );

/** Whether a request is made to the loopback address the server is on,
 * from no page or from the window's own, so that a page which points a
 * name of its own at it, or a page of another origin, reads nothing. */
function isLoopback(request: IncomingMessage): boolean {
  const { host, origin } = request.headers;
  if (!toLoopback(request)) return false;
  return origin === undefined || origin === `http://${host}`;
}

/** Whether a request names the loopback address as its host. */
const toLoopback = (request: IncomingMessage) =>
  // A request with no Host header reads as "undefined": no loopback name.
  /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(request.headers.host));

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

/** A window's request, if `data` holds one: `{ id, method, params }`. */
function requestIn(
  data: unknown
): { id: string | number; method: string; params?: unknown } | undefined {
  try {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    const { id, method } = frame;
    if (
      (typeof id === "string" || typeof id === "number") &&
      typeof method === "string" &&
      method !== ""
    )
      return { id, method, params: frame.params };
  } catch {
    // Not JSON: no request.
  }
  return undefined;
}

/** What a window is sent for `event`, if it listens to the contract's
 * events or not. */
function frameOf(event: InspectorEvent, listening: boolean) {
  if ("ended" in event) return { ended: event.ended };
  if ("newTab" in event) return { reset: true };
  return listening ? { event: event.contract } : undefined;
}

/** The window of one Session, once served. */
export interface InspectorWindow {
  /** Where `ayme inspect` opens the window, with the Session's token in
   * the fragment, such as `http://127.0.0.1:53124/inspector#token=…`. */
  readonly address: string;
  /** The window's socket with the Session's token, which the Inspector an
   * Agent App shows in its chat connects to. */
  readonly agentAppSocket: string;
  /** Hands it the Session. A window's request before then waits. */
  attach(session: Pick<Session, "ask" | "events">): void;
  /** Closes every window, once each took its last frames, then the
   * server. */
  close(): Promise<void>;
}

/**
 * Serves the Inspector window of the Session named `name` at a free port of
 * the loopback address: its page, the Inspector's built `script`, and a
 * socket for each window that brings the Session's token (ADR-0072),
 * from any origin. Each window hears the Session's events from when it
 * connects, the contract's own while it subscribed, and is closed once
 * told the Session ended.
 */
export async function serveInspectorWindow({
  name,
  script,
}: {
  readonly name: string;
  readonly script: string;
}): Promise<InspectorWindow> {
  const attached = Deferred.makeUnsafe<Pick<Session, "ask" | "events">>();
  const session = Effect.runPromise(Deferred.await(attached));
  const sockets = new WebSocketServer({ noServer: true });
  const token = newToken();
  const server = createServer((request, response) => {
    const path = pathOf(request);
    if (!isLoopback(request))
      return send(response, 403, "text/plain", "Not a loopback request.");
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
    if (
      pathOf(request) !== SOCKET_PATH ||
      !toLoopback(request) ||
      !bringsToken(request, token)
    )
      return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    sockets.handleUpgrade(
      request,
      socket,
      head,
      (ws) =>
        void session.then((attachedSession) => accept(ws, attachedSession))
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    address: withTokenFragment(`http://127.0.0.1:${port}${PAGE_PATH}`, token),
    agentAppSocket: withToken(`ws://127.0.0.1:${port}${SOCKET_PATH}`, token),
    attach: (attaching) =>
      Deferred.doneUnsafe(attached, Exit.succeed(attaching)),
    close: async () => {
      await Promise.all(
        [...sockets.clients].map((ws) => {
          const closed = new Promise((resolve) => ws.once("close", resolve));
          ws.close();
          return Promise.race([
            closed,
            new Promise((resolve) => setTimeout(resolve, FLUSH_LIMIT_MS)),
          ]).finally(() => ws.terminate());
        })
      );
      sockets.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Carries the Inspector's contract between the window `ws` and
 * `session`, until the window closes or is told the Session ended. */
function accept(ws: WebSocket, session: Pick<Session, "ask" | "events">) {
  let listening = false;
  const reply = (frame: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };
  const hearing = Effect.runFork(
    Stream.runForEach(session.events, (event) =>
      Effect.sync(() => {
        const frame = frameOf(event, listening);
        if (frame) reply(frame);
        if ("ended" in event) ws.close();
      })
    )
  );
  ws.once("close", () => void Effect.runFork(Fiber.interrupt(hearing)));
  ws.on("message", (data) => {
    const request = requestIn(data);
    if (!request) return;
    const { id, method, params } = request;
    if (method === "subscribe" || method === "unsubscribe") {
      listening = method === "subscribe";
      return reply({ id, result: null });
    }
    void Effect.runPromise(
      session.ask({ inspector: { contract: { method, params } } })
    ).then((answer) =>
      reply(
        answer.ok
          ? { id, result: answer.data ?? null }
          : { id, error: answer.text }
      )
    );
  });
}
