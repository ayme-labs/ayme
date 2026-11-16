import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

import type { ServerExtension } from "../../connection";
import { isLoopbackHostHeader } from "../../pairing";
import {
  INSPECTOR_HTML,
  INSPECTOR_INSTALL_HINT,
  INSPECTOR_PATH,
  INSPECTOR_SCRIPT_PATH,
  INSPECTOR_SOCKET_PATH,
} from "../domain/externalInspector";
import { WindowRequestSchema } from "../domain/windowFrames";
import type { InspectorRelay } from "../application/inspectorRelay";

/**
 * The external Inspector on the server's own HTTP server (no new server and
 * no new port): its page and script at `/inspector`, and a WebSocket at
 * `/inspector/ws` for each window, relayed to the paired page. `readBuild`
 * reads the script from `@ayme-dev/inspector`, or resolves with nothing
 * when the optional package is not installed. Only a request whose `Host`
 * is the loopback server's is answered, so a page that rebinds a name to
 * 127.0.0.1 reads nothing; a window must come from the page the server
 * served.
 */
export function externalInspectorServer({
  relay,
  readBuild,
}: {
  relay: InspectorRelay;
  readBuild(): Promise<string | undefined>;
}): ServerExtension {
  const sockets = new WebSocketServer({ noServer: true });
  return {
    request(request, response) {
      const path = (request.url ?? "").split("?")[0];
      const isPage = path === INSPECTOR_PATH || path === `${INSPECTOR_PATH}/`;
      if (!isPage && path !== INSPECTOR_SCRIPT_PATH) return false;
      if (!isLoopbackHostHeader(request.headers.host)) {
        send(response, 403, "text/plain", "Not a loopback request.");
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "text/plain", "Only GET is served here.");
      } else if (isPage) {
        send(response, 200, "text/html; charset=utf-8", INSPECTOR_HTML);
      } else {
        void readBuild().then((build) =>
          build === undefined || build === null
            ? send(response, 503, "text/plain", INSPECTOR_INSTALL_HINT)
            : send(response, 200, "text/javascript; charset=utf-8", build)
        );
      }
      return true;
    },
    upgrade(request, socket, head) {
      if (request.url?.split("?")[0] !== INSPECTOR_SOCKET_PATH) return false;
      if (!fromThisServer(request)) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return true;
      }
      sockets.handleUpgrade(request, socket as Duplex, head, (ws) =>
        accept(relay, ws)
      );
      return true;
    },
    close() {
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      relay.dispose();
    },
  };
}

/** Whether the window comes from the page this server served, or from a local process. */
function fromThisServer(request: IncomingMessage) {
  const { origin, host } = request.headers;
  if (!isLoopbackHostHeader(host)) return false;
  return origin === undefined || origin === `http://${host}`;
}

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string
) {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  response.end(body);
}

function accept(relay: InspectorRelay, ws: WebSocket) {
  const window = relay.open({
    send: (reply) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(reply));
    },
  });
  ws.on("message", (data) => {
    let request: ReturnType<typeof WindowRequestSchema.safeParse>;
    try {
      request = WindowRequestSchema.safeParse(JSON.parse(String(data)));
    } catch {
      return;
    }
    if (request.success) window.receive(request.data);
  });
  ws.once("close", () => window.close());
}
