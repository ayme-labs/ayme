import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { BuiltModules, PageObjectsBuild } from "./pageObjectsBuild";
import { servedPageObjectsServer } from "./servedPageObjectsServer";

/** A build the test rebuilds by hand. */
function fakeBuild(first: BuiltModules) {
  let last = first;
  const listeners = new Set<(modules: BuiltModules) => void>();
  const build: PageObjectsBuild = {
    modules: async () => last,
    onBuilt(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: async () => {},
  };
  return {
    build,
    rebuild(modules: BuiltModules) {
      last = modules;
      for (const listener of listeners) listener(modules);
    },
  };
}

let server: Server | undefined;
afterEach(() => new Promise((resolve) => server?.close(resolve)));

async function serve(build: PageObjectsBuild) {
  const extension = servedPageObjectsServer(Promise.resolve(build));
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

it("serves the chunks of an earlier build after a rebuild, for a page still importing it", async () => {
  const { build, rebuild } = fakeBuild(modules("old entry", "chunk-OLD.js"));
  const get = await serve(build);
  await get("entry.js");

  rebuild(modules("new entry", "chunk-NEW.js"));

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
  const { build, rebuild } = fakeBuild(modules("old entry", "chunk-OLD.js"));
  const get = await serve(build);
  const { entry: stamp } = await get.stamp();

  rebuild(modules("new entry", "chunk-NEW.js"));

  expect((await get(`entry.js?build=${stamp}`)).text).toBe("old entry");
  expect((await get("entry.js?build=unknown")).status).toBe(404);
});
