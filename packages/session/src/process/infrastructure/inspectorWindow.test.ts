import { once } from "node:events";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope, Stream } from "effect";
import { connect, type Socket } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { WebSocket } from "ws";

import { scriptedBrowser } from "../../../testing";
import { serveSession } from "./background";
import { serveInspectorWindow } from "./inspectorWindow";
import { privateFolder } from "./record";

// The Inspector window a Session's process serves, reached as a browser
// window reaches it: over HTTP and a WebSocket, on a Session that runs on
// the scripted browser in this process.

/** The Inspector's built script, as the CLI ships it beside itself. */
const SCRIPT = "/* the Inspector's external build */";

/** Serves a Session named "shop" on a scripted browser, with its window,
 * until the test ends; with `heldScript`, a read of the Inspector's script
 * never ends. */
async function serve({ heldScript = false } = {}) {
  const made = realpathSync(mkdtempSync(join(tmpdir(), "ayme-window-")));
  const script = join(made, "external.mjs");
  if (heldScript) {
    // A named pipe nobody writes to: a read of it waits until the test
    // ends, when the pipe is opened and closed to end it.
    execFileSync("mkfifo", [script]);
    onTestFinished(() => {
      try {
        closeSync(openSync(script, constants.O_WRONLY | constants.O_NONBLOCK));
      } catch {
        // Nothing reads it.
      }
    });
  } else writeFileSync(script, SCRIPT);
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

/** The window's socket at `address`, with the token its fragment holds. */
function socketUrl(address: string) {
  const url = new URL("/inspector/ws", address);
  url.protocol = "ws:";
  url.search = new URL(address).hash.slice(1);
  return url;
}

/** A window's socket to the server at `address`, with the token its
 * fragment holds, sending `origin` when given, and what it was told, in
 * order. */
async function windowSocket(address: string, origin?: string) {
  const socket = new WebSocket(
    socketUrl(address),
    origin ? { headers: { origin } } : {}
  );
  onTestFinished(() => socket.terminate());
  const told: unknown[] = [];
  socket.on("message", (data) => told.push(JSON.parse(String(data))));
  await once(socket, "open");
  let id = 0;
  return {
    socket,
    told: told as object[],
    /** Sends a request, on the Tab `tab` when given, and resolves with
     * its reply. */
    async request(method: string, params?: unknown, tab?: number) {
      const asked = ++id;
      socket.send(JSON.stringify({ id: asked, method, params, tab }));
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

it.each(["evil.test", "localhost"])(
  "answers nothing to a request named %s, only to the address it printed, so the window's own tab is always told apart from the Session's",
  async (name) => {
    const { address } = await serve();
    const { port } = new URL(address);
    const named = { host: `${name}:${port}` };

    const { statusCode } = await new Promise<{ statusCode?: number }>(
      (resolve) => {
        void import("node:http").then(({ get }) =>
          get(
            { host: "127.0.0.1", port, path: "/inspector", headers: named },
            resolve
          )
        );
      }
    );
    const socket = new WebSocket(socketUrl(address), { headers: named });
    onTestFinished(() => socket.terminate());

    expect(statusCode).toBe(403);
    const [error] = (await once(socket, "error")) as [Error];
    expect(error.message).toContain("403");
  }
);

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

it("tells a window the Tab it shows, the contract's events once it subscribed, and each new Tab, which its calls name", async () => {
  const { address, browser } = await serve();
  const window = await windowSocket(address);

  expect(await window.request("subscribe")).toEqual({ id: 1, result: null });
  await expect.poll(() => browser.inspectorListeners).toBe(1);
  browser.tellInspector({ type: "state" });
  const other = browser.openTab("http://127.0.0.1:5173/other");

  await expect
    .poll(() => window.told.filter((frame) => !Object.hasOwn(frame, "id")))
    .toEqual([{ tab: 1 }, { event: { type: "state" } }, { tab: 2 }]);
  expect(await window.request("look", undefined, 1)).toEqual({
    id: 2,
    error:
      "The Inspector shows another Tab now, so ayme did not carry out this call on the Tab the window showed.",
  });
  expect(await window.request("look", undefined, 2)).toEqual({
    id: 3,
    result: "look",
  });
  expect(other.inspectorCalls.map(({ method }) => method)).toEqual(["look"]);
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

it("closing one of two windows keeps the subscription to the Tab's contract, which ends the windows' highlights only with the last", async () => {
  const { address, browser } = await serve();
  const first = await windowSocket(address);
  const second = await windowSocket(address);
  await first.request("subscribe");
  await second.request("subscribe");
  await expect.poll(() => browser.inspectorListeners).toBe(1);
  await second.request("highlight", { layer: "pinned", refs: ["e1"] }, 1);

  second.socket.close();
  await once(second.socket, "close");
  browser.tellInspector({ type: "state" });

  await expect
    .poll(() => first.told)
    .toContainEqual({ event: { type: "state" } });
  expect(browser.inspectorListeners).toBe(1);
  first.socket.close();
  await expect.poll(() => browser.inspectorListeners).toBe(0);
});

it("a window that closes releases the reads it started, while a Run it started goes on", async () => {
  const { address, browser } = await serve();
  const window = await windowSocket(address);
  const released = new Map<string, AbortSignal>();
  let finish = () => {};
  browser.answerInspector(
    (method, _params, signal) =>
      new Promise((resolve) => {
        released.set(method, signal);
        if (method === "runTool") finish = () => resolve("ran");
      })
  );
  window.socket.send(JSON.stringify({ id: 1, method: "look", tab: 1 }));
  window.socket.send(
    JSON.stringify({
      id: 2,
      method: "runTool",
      params: { name: "Basket.add", input: {} },
      tab: 1,
    })
  );
  await expect.poll(() => released.size).toBe(2);

  window.socket.close();

  await expect.poll(() => released.get("look")?.aborted).toBe(true);
  expect(released.get("runTool")?.aborted).toBe(false);
  finish();
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

describe("closing, within the one limit of how long it waits for the windows", () => {
  it("takes no window that connects while a window that does not read its socket drains, and still ends", async () => {
    const window = await serveInspectorWindow({ name: "shop", script: "" });
    onTestFinished(() => window.close());
    window.attach({ ask: () => Effect.never, events: Stream.never });
    const stuck = new WebSocket(socketUrl(window.address));
    onTestFinished(() => stuck.terminate());
    await once(stuck, "open");
    // A window that stops reading never answers the close.
    (stuck as unknown as { _socket: Socket })._socket.pause();

    const closing = window.close();
    const late = new WebSocket(socketUrl(window.address));
    onTestFinished(() => late.terminate());
    const outcome = await new Promise<string>((resolve) => {
      late.once("open", () => resolve("open"));
      late.once("error", (error) => resolve(error.message));
    });

    expect(outcome).not.toBe("open");
    await closing;
  });

  it("ends an HTTP request still open", async () => {
    const { address, close } = await serve({ heldScript: true });
    const { port, host } = new URL(address);
    const held = connect(Number(port), "127.0.0.1");
    onTestFinished(() => void held.destroy());
    const ended = new Promise((resolve) => held.once("close", resolve));
    held.on("error", () => {});
    await once(held, "connect");
    // The script's read never ends, so neither does the answer.
    held.write(`GET /inspector/external.mjs HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await close();

    await ended;
  });
});
