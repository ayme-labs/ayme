import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";

import type {
  BuiltModules,
  SettledBuildState,
  PageObjectsBuildState,
} from "../domain/buildState";
import type { PageObjectsBuild } from "./pageObjectsBuild";
import { servedPageObjectsServer } from "./servedPageObjectsServer";

/** A build whose settled outcomes the test publishes by hand. */
function fakeBuild(first: SettledBuildState) {
  let state = first;
  const listeners = new Set<(state: PageObjectsBuildState) => void>();
  const build: PageObjectsBuild = {
    get state() {
      return state;
    },
    whenSettled: async () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: async () => {},
  };
  return {
    build,
    publish(next: SettledBuildState) {
      state = next;
      for (const listener of listeners) listener(state);
    },
  };
}

let server: Server | undefined;
afterEach(() => new Promise((resolve) => server?.close(resolve)));

async function serve(build: PageObjectsBuild) {
  const extension = servedPageObjectsServer(build);
  server = createServer((request, response) => {
    if (!extension.request(request, response)) response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    if (!extension.upgrade(request, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const get = async (path: string) => {
    const response = await fetch(
      `http://127.0.0.1:${port}/page-objects/${path}`
    );
    return { status: response.status, text: await response.text() };
  };
  /** The stamp of the last good build, as a page following the builds gets it. */
  const stamp = () =>
    new Promise<{ entry: string }>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/page-objects/events`
      );
      socket.once("message", (data) => {
        resolve(JSON.parse(String(data)) as { entry: string });
        socket.close();
      });
      socket.once("error", reject);
    });
  return Object.assign(get, { stamp });
}

const modules = (entry: string, chunk: string) =>
  new Map([
    ["entry.js", entry],
    ["runtime.js", "runtime"],
    [chunk, `${chunk} code`],
  ]);

const entry = "/project/ayme/page-objects.ts";
const built = (modules: BuiltModules): SettledBuildState => ({
  kind: "built",
  entry,
  modules,
});

it("serves the chunks of an earlier build after a rebuild, for a page still importing it", async () => {
  const { build, publish } = fakeBuild(
    built(modules("old entry", "chunk-OLD.js"))
  );
  const get = await serve(build);
  await get("entry.js");

  publish(built(modules("new entry", "chunk-NEW.js")));

  expect(await get("chunk-OLD.js")).toEqual({
    status: 200,
    text: "chunk-OLD.js code",
  });
  expect(await get("chunk-NEW.js")).toEqual({
    status: 200,
    text: "chunk-NEW.js code",
  });
  expect((await get("entry.js")).text).toBe("new entry");
});

it("serves the entry of the build a stamp names", async () => {
  const { build, publish } = fakeBuild(
    built(modules("old entry", "chunk-OLD.js"))
  );
  const get = await serve(build);
  const { entry: stamp } = await get.stamp();

  publish(built(modules("new entry", "chunk-NEW.js")));

  expect((await get(`entry.js?build=${stamp}`)).text).toBe("old entry");
  expect((await get("entry.js?build=unknown")).status).toBe(404);
});

it("serves the first failure until a good build, then keeps serving that build across a failure", async () => {
  const errors = [{ text: "Unexpected end of file", location: null }];
  const { build, publish } = fakeBuild({ kind: "never-built", entry, errors });
  const get = await serve(build);
  expect(await get("entry.js")).toEqual({
    status: 500,
    text: `The Page Objects entry ${entry} did not build. No build of it has succeeded, so none is served.\n  Unexpected end of file`,
  });

  const good = modules("good entry", "chunk-GOOD.js");
  publish(built(good));
  publish({ kind: "rebuild-failed", entry, modules: good, errors });
  expect(await get("entry.js")).toEqual({ status: 200, text: "good entry" });
});
