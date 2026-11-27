import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { WebSocket } from "ws";

import { scriptedBrowser } from "../../../testing";
import { serveSession } from "./background";
import { privateFolder } from "./record";

// The Inspector window a Session's process serves, reached as a browser
// window reaches it: over HTTP and a WebSocket, on a Session that runs on
// the scripted browser in this process.

/** The Inspector's built script, as the CLI ships it beside itself. */
const SCRIPT = "/* the Inspector's external build */";

/** Serves a Session named "shop" on a scripted browser, with its window,
 * until the test ends. */
async function serve() {
  const made = realpathSync(mkdtempSync(join(tmpdir(), "ayme-window-")));
  const script = join(made, "external.mjs");
  writeFileSync(script, SCRIPT);
  const { folder, socket } = privateFolder();
  onTestFinished(() => {
    rmSync(made, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  });
  const { layer, browser } = scriptedBrowser();
  const scope = Effect.runSync(Scope.make());
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const session = await Effect.runPromise(
    serveSession({
      socket,
      request: { open: { headed: false } },
      name: "shop",
      inspectorScript: script,
    }).pipe(Effect.provide(layer), Scope.provide(scope))
  );
  const answer = await Effect.runPromise(
    session.ask({ inspector: { window: {} } })
  );
  if (!answer.ok) throw new Error(answer.text);
  const { address } = answer.data as { address: string };
  return {
    session,
    browser,
    address,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

/** A window's socket to the server at `address`, with the token its
 * fragment holds, sending `origin` when given, and what it was told, in
 * order. */
async function windowSocket(address: string, origin?: string) {
  const url = new URL("/inspector/ws", address);
  url.protocol = "ws:";
  url.search = new URL(address).hash.slice(1);
  const socket = new WebSocket(url, origin ? { headers: { origin } } : {});
  onTestFinished(() => socket.terminate());
  const told: unknown[] = [];
  socket.on("message", (data) => told.push(JSON.parse(String(data))));
  await once(socket, "open");
  let id = 0;
  return {
    socket,
    told,
    /** Sends a request and resolves with its reply. */
    async request(method: string, params?: unknown) {
      const asked = ++id;
      socket.send(JSON.stringify({ id: asked, method, params }));
      await expect
        .poll(() =>
          told.find((frame) => (frame as { id?: number }).id === asked)
        )
        .toBeDefined();
      return told.find((frame) => (frame as { id?: number }).id === asked);
    },
  };
}

it("serves the window's page and the Inspector's script on the loopback address, at the address ayme inspect is told", async () => {
  const { address } = await serve();

  expect(address).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+$/
  );
  const page = await fetch(address);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain(
    '<script type="module" src="/inspector/external.mjs">'
  );
  expect(html).toContain("<title>ayme inspect: shop</title>");
  const script = await fetch(new URL("/inspector/external.mjs", address));
  expect(script.headers.get("content-type")).toContain("text/javascript");
  expect(await script.text()).toBe(SCRIPT);
  expect((await fetch(new URL("/other", address))).status).toBe(404);
});

it("answers nothing to a request named for another host, so a page that points a name of its own at it reads nothing", async () => {
  const { address } = await serve();
  const { port } = new URL(address);

  const { statusCode } = await new Promise<{ statusCode?: number }>(
    (resolve) => {
      void import("node:http").then(({ get }) =>
        get(
          {
            host: "127.0.0.1",
            port,
            path: "/inspector",
            headers: { host: `evil.test:${port}` },
          },
          resolve
        )
      );
    }
  );

  expect(statusCode).toBe(403);
});

it("refuses a window's socket from a page of another origin", async () => {
  const { address } = await serve();
  const url = new URL("/inspector/ws", address);
  url.protocol = "ws:";

  const socket = new WebSocket(url, {
    headers: { origin: "http://evil.test" },
  });
  onTestFinished(() => socket.terminate());

  const [error] = (await once(socket, "error")) as [Error];
  expect(error.message).toContain("403");
});

it("answers a window's call with what the contract of the Session's Tab answered, and an error with why", async () => {
  const { address, browser } = await serve();
  const window = await windowSocket(address, new URL(address).origin);

  expect(await window.request("getState")).toEqual({
    id: 1,
    result: "getState",
  });
  browser.answerInspector(() => Promise.reject(new Error("It broke.")));
  expect(await window.request("look")).toEqual({ id: 2, error: "It broke." });
  expect(browser.inspectorCalls.map(({ method }) => method)).toEqual([
    "getState",
    "look",
  ]);
});

it("tells a window that subscribed the contract's events, and a new page when the Session works on another Tab", async () => {
  const { address, browser } = await serve();
  const window = await windowSocket(address);

  expect(await window.request("subscribe")).toEqual({ id: 1, result: null });
  await expect.poll(() => browser.inspectorListeners).toBe(1);
  browser.tellInspector({ type: "state" });
  browser.openTab("http://127.0.0.1:5173/other");

  await expect
    .poll(() => window.told.slice(1))
    .toEqual([{ event: { type: "state" } }, { reset: true }]);
});

it("a window that closes ends the Session's subscription to the Tab's contract, and the Session goes on", async () => {
  const { address, browser, session } = await serve();
  const window = await windowSocket(address);
  await window.request("subscribe");
  await expect.poll(() => browser.inspectorListeners).toBe(1);

  window.socket.close();

  await expect.poll(() => browser.inspectorListeners).toBe(0);
  expect(await Effect.runPromise(session.ask({ tools: {} }))).toMatchObject({
    ok: true,
  });
});

it("tells each window how the Session ended, and then closes it", async () => {
  const { address, session } = await serve();
  const window = await windowSocket(address);
  await window.request("subscribe");
  const closed = once(window.socket, "close");

  await Effect.runPromise(session.ask({ stop: {} }));

  await closed;
  expect(window.told.at(-1)).toEqual({
    ended:
      "The Session shop was closed. Start a Session with ayme open or ayme attach, then run ayme -s=shop inspect to inspect it.",
  });
});
