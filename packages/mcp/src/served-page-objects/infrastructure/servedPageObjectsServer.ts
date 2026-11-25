import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

import type { ServerExtension } from "../../connection";
import { isLoopbackHostHeader } from "../../pairing";
import { buildFailure } from "../domain/buildFailure";
import type { BuiltModules, PageObjectsBuildState } from "../domain/buildState";
import {
  ENTRY_MODULE,
  EVENTS_PATH,
  RUNTIME_MODULE,
  SERVED_PATH,
} from "../domain/servedPageObjects";
import type { PageObjectsBuild } from "./pageObjectsBuild";

/** How many good builds stay served, so a page importing one finishes it. */
const KEPT_BUILDS = 10;

/** What tells one build from another to a page. */
type Stamp = { entry: string; runtime: string };

/**
 * The built Page Objects on the server's own HTTP server (no new server and
 * no new port), each module at `/page-objects/<path>`, or why no build
 * succeeded. `entry.js?build=<stamp>` and `runtime.js?build=<stamp>` are
 * those of the build with that stamp, and the chunks of the last few good
 * builds stay served, so a page importing one build gets all of it across
 * rebuilds. A WebSocket at `/page-objects/events` tells a page the stamp of
 * the last good build, then of each new one, so the init script loads that
 * build and swaps in the Page Objects of each rebuild; unlike a stream over
 * HTTP, it holds none of the browser's few connections to the server. Any
 * page may import the modules, as an init script does in whatever page it
 * runs, but only a request whose `Host` is the loopback server's is
 * answered, as the external Inspector's are.
 */
export function servedPageObjectsServer(
  build: PageObjectsBuild
): ServerExtension {
  const sockets = new WebSocketServer({ noServer: true });
  const builds = keptBuilds(build);
  return {
    request(request, response) {
      const [path, query = ""] = (request.url ?? "").split("?") as [
        string,
        string?,
      ];
      if (!path.startsWith(SERVED_PATH)) return false;
      if (!isLoopbackHostHeader(request.headers.host)) {
        send(response, 403, "text/plain", "Not a loopback request.");
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "text/plain", "Only GET is served here.");
      } else {
        const name = path.slice(SERVED_PATH.length);
        const stamp = new URLSearchParams(query).get("build") ?? undefined;
        builds.module(name, stamp).then(
          (result) => {
            if ("error" in result)
              send(response, 500, "text/plain", result.error);
            else if (result.code === undefined)
              send(response, 404, "text/plain", `No module ${request.url}.`);
            else
              send(
                response,
                200,
                "text/javascript; charset=utf-8",
                result.code
              );
          },
          (error: unknown) =>
            send(response, 500, "text/plain", (error as Error).message)
        );
      }
      return true;
    },
    upgrade(request, socket, head) {
      if (request.url?.split("?")[0] !== EVENTS_PATH) return false;
      if (!isLoopbackHostHeader(request.headers.host)) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return true;
      }
      sockets.handleUpgrade(request, socket as Duplex, head, (ws) =>
        builds.follow(ws)
      );
      return true;
    },
    close() {
      builds.stop();
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
    },
  };
}

/** The last {@link KEPT_BUILDS} good builds, newest first, and their stamps. */
function keptBuilds(build: PageObjectsBuild) {
  const kept: { stamp: Stamp; modules: BuiltModules }[] = [];
  const keep = (state: PageObjectsBuildState) => {
    if (state.kind !== "built" && state.kind !== "rebuild-failed") return;
    const { modules } = state;
    if (kept[0]?.modules === modules) return;
    kept.unshift({ stamp: stampOf(modules), modules });
    kept.length = Math.min(kept.length, KEPT_BUILDS);
  };
  const stop = build.subscribe(keep);
  keep(build.state);

  /** A chunk can finish loading after the page has been offered a new build. */
  function moduleCode(name: string, stamp?: string) {
    const part =
      name === ENTRY_MODULE
        ? "entry"
        : name === RUNTIME_MODULE
          ? "runtime"
          : undefined;
    if (part !== undefined)
      return (
        stamp === undefined
          ? kept[0]
          : kept.find((k) => k.stamp[part] === stamp)
      )?.modules.get(name);
    for (const { modules } of kept) {
      const code = modules.get(name);
      if (code !== undefined) return code;
    }
    return undefined;
  }

  return {
    stop,
    async module(
      name: string,
      stamp?: string
    ): Promise<{ code: string | undefined } | { error: string }> {
      if (kept.length === 0) {
        const state = await build.whenSettled();
        switch (state.kind) {
          case "cannot-start":
          case "watching-install":
            return { error: state.error };
          case "never-built":
            return { error: buildFailure({ ...state, lastGood: false }) };
          case "built":
          case "rebuild-failed":
            break;
        }
      }
      return { code: moduleCode(name, stamp) };
    },
    /** Sends `ws` the stamp of the last good build, then of each new one. */
    follow(ws: WebSocket) {
      const sendStamp = () => kept[0] && ws.send(JSON.stringify(kept[0].stamp));
      // The cache subscribed first, so a new build is kept before its stamp is sent.
      const unfollow = build.subscribe((state) => {
        if (state.kind === "built") sendStamp();
      });
      ws.once("close", unfollow);
      sendStamp();
    },
  };
}

/**
 * What tells one build from another to a page: a hash of the entry module
 * and of the runtime module, which a page cannot swap without reloading.
 */
function stampOf(modules: BuiltModules): Stamp {
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
