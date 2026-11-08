import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";

import type { ServerExtension } from "../../connection";
import { isLoopbackHostHeader } from "../../pairing";
import {
  ENTRY_MODULE,
  EVENTS_PATH,
  RUNTIME_MODULE,
  SERVED_PATH,
} from "../domain/servedPageObjects";
import type { BuiltModules, PageObjectsBuild } from "./pageObjectsBuild";

/**
 * The built Page Objects on the server's own HTTP server (no new server and
 * no new port), each module of the last good build at `/page-objects/<path>`,
 * or why no build succeeded. At `/page-objects/events`, an event stream
 * tells a page the stamp of the last good build, then of each new one, so
 * the init script swaps in the Page Objects of a rebuild. Any page may
 * import them, as an init script does in whatever page it runs, but only a
 * request whose `Host` is the loopback server's is answered, as the
 * external Inspector's are.
 */
export function servedPageObjectsServer(
  build: Promise<PageObjectsBuild>
): ServerExtension {
  const streams = new Set<ServerResponse>();
  return {
    request(request, response) {
      const path = (request.url ?? "").split("?")[0]!;
      if (!path.startsWith(SERVED_PATH)) return false;
      if (!isLoopbackHostHeader(request.headers.host)) {
        send(response, 403, "text/plain", "Not a loopback request.");
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "text/plain", "Only GET is served here.");
      } else if (path === EVENTS_PATH) {
        streamStamps(response, build, streams);
      } else {
        const name = path.slice(SERVED_PATH.length);
        build
          .then((b) => b.modules())
          .then(
            (built) => {
              const code = built.get(name);
              if (code === undefined)
                send(response, 404, "text/plain", `No module ${path}.`);
              else send(response, 200, "text/javascript; charset=utf-8", code);
            },
            (error: unknown) =>
              send(response, 500, "text/plain", (error as Error).message)
          );
      }
      return true;
    },
    upgrade: () => false,
    close() {
      for (const stream of streams) stream.end();
    },
  };
}

/**
 * Sends the stamp of the last good build, then of each new one, as server
 * sent events, until the page goes.
 */
function streamStamps(
  response: ServerResponse,
  build: Promise<PageObjectsBuild>,
  streams: Set<ServerResponse>
) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  streams.add(response);
  const send = (modules: BuiltModules) =>
    response.write(`data: ${JSON.stringify(stampOf(modules))}\n\n`);
  build.then(
    (b) => {
      const stop = b.onBuilt(send);
      response.once("close", () => {
        stop();
        streams.delete(response);
      });
      b.modules().then(send, () => {});
    },
    () => response.end()
  );
}

/**
 * What tells one build from another to a page: a hash of the entry module
 * and of the runtime module, which a page cannot swap without reloading.
 */
function stampOf(modules: BuiltModules) {
  const hash = (name: string) =>
    createHash("sha256")
      .update(modules.get(name) ?? "")
      .digest("hex")
      .slice(0, 16);
  return { entry: hash(ENTRY_MODULE), runtime: hash(RUNTIME_MODULE) };
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
    // A module script is fetched in CORS mode, from the page's own origin.
    "access-control-allow-origin": "*",
  });
  response.end(body);
}
