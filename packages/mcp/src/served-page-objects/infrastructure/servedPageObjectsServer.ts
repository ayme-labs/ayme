import type { ServerResponse } from "node:http";

import type { ServerExtension } from "../../connection";
import { isLoopbackHostHeader } from "../../pairing";
import { SERVED_PATH } from "../domain/servedPageObjects";
import type { BuiltModules } from "./pageObjectsBuild";

/**
 * The built Page Objects on the server's own HTTP server (no new server and
 * no new port), each module at `/page-objects/<path>`. `modules` resolves
 * with the latest build, or rejects with why it failed. Any page may import
 * them, as an init script does in whatever page it runs, but only a request
 * whose `Host` is the loopback server's is answered, as the external
 * Inspector's are.
 */
export function servedPageObjectsServer(
  modules: () => Promise<BuiltModules>
): ServerExtension {
  return {
    request(request, response) {
      const path = (request.url ?? "").split("?")[0]!;
      if (!path.startsWith(SERVED_PATH)) return false;
      if (!isLoopbackHostHeader(request.headers.host)) {
        send(response, 403, "text/plain", "Not a loopback request.");
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "text/plain", "Only GET is served here.");
      } else {
        const name = path.slice(SERVED_PATH.length);
        modules().then(
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
    close() {},
  };
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
