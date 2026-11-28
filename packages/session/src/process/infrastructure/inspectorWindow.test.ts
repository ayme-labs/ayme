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

/** An Inspector's script in `folder` whose reads wait until it is
 * released, or until the test ends. */
function heldScript(folder: string) {
  const script = join(folder, "external.mjs");
  // A named pipe: a read of it waits until the pipe is opened and closed.
  execFileSync("mkfifo", [script]);
  const release = () => {
    try {
      closeSync(openSync(script, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch {
      // Nothing reads it.
    }
  };
  onTestFinished(release);
  return { script, release };
}

/** Serves a Session named "shop" on a scripted browser, with its window,
 * until the test ends; with `heldScript`, a read of the Inspector's script
 * never ends. */
async function serve({ heldScript: held = false } = {}) {
  const made = realpathSync(mkdtempSync(join(tmpdir(), "ayme-window-")));
  const script = held ? heldScript(made).script : join(made, "external.mjs");
  if (!held) writeFileSync(script, SCRIPT);
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
  const ask = async (request: Parameters<typeof session.ask>[0]) => {
    const answer = await Effect.runPromise(session.ask(request));
    if (!answer.ok) throw new Error(answer.text);
    return answer.data as Record<string, string>;
  };
  const { address } = await ask({ inspector: { window: {} } });
  const { socket: tokenSocket } = await ask({ inspector: { agentApp: {} } });
  return {
    session,
    browser,
    address: address!,
    /** The window's socket with the Session's token, which admits a
     * client of any origin. */
    socket: tokenSocket!,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

/** A window connected at `url`, sending `origin` when given, and what it
 * was told, in order. */
async function windowSocket(url: string, origin?: string) {
  const socket = new WebSocket(url, origin ? { headers: { origin } } : {});
  onTestFinished(() => socket.terminate());
  const told: unknown[] = [];
  socket.on("message", (data) => told.push(JSON.parse(String(data))));
  await once(socket, "open");
  let id = 0;
  return {
    socket,
    told: told as object[],
    /** Sends a request, on the Tab `tab`, or else on the Tab the Session
     * told the window last, as the window does, and resolves with its
     * reply. */
    async request(method: string, params?: unknown, tab?: number) {
      const asked = ++id;
      const toldTab = () =>
        (
          told.findLast((frame) => Object.hasOwn(frame as object, "tab")) as
            { tab: number } | undefined
        )?.tab;
      await expect.poll(toldTab).toBeDefined();
      socket.send(
        JSON.stringify({ id: asked, method, params, tab: tab ?? toldTab() })
      );
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

  expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/inspector$/);
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

it("serves the window's page at its address with a trailing slash or a query too, as HTML no cache keeps", async () => {
  const { address } = await serve();

  for (const path of ["/inspector", "/inspector/", "/inspector?tab=1"]) {
    const page = await fetch(new URL(path, address));
    expect(page.status, path).toBe(200);
    expect(page.headers.get("content-type"), path).toBe(
      "text/html; charset=utf-8"
    );
    expect(page.headers.get("cache-control"), path).toBe("no-store");
    expect(await page.text(), path).toContain(
      "<title>ayme inspect: shop</title>"
    );
  }
});

it("answers any other path with why", async () => {
  const { address } = await serve();

  const other = await fetch(new URL("/inspector/other", address));

  expect(other.status).toBe(404);
  expect(other.headers.get("content-type")).toBe("text/plain");
  expect(await other.text()).toBe("Not found.");
});

it("serves GET and HEAD only, and answers another method with why", async () => {
  const { address } = await serve();

  expect((await fetch(address, { method: "HEAD" })).status).toBe(200);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const refused = await fetch(address, { method });
    expect(refused.status, method).toBe(405);
    expect(refused.headers.get("content-type"), method).toBe("text/plain");
    expect(await refused.text(), method).toBe("Only GET is served here.");
  }
});

it("answers a request for the Inspector's script that cannot be read with why", async () => {
  const window = await serveInspectorWindow({
    name: "shop",
    script: join(tmpdir(), "ayme-missing", "external.mjs"),
    started: Effect.never,
  });
  onTestFinished(() => window.close());

  const script = await fetch(
    new URL("/inspector/external.mjs", window.address)
  );

  expect(script.status).toBe(503);
  expect(script.headers.get("content-type")).toBe("text/plain");
  expect(await script.text()).toMatch(
    /^The Inspector's script could not be read: ENOENT: .*external\.mjs'$/
  );
});

it.each(["evil.test", "localhost"])(
  "answers nothing to a request named %s, only to the address it printed, so the window's own tab is always told apart from the Session's",
  async (name) => {
    const { address, socket: url } = await serve();
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
    const socket = new WebSocket(url, { headers: named });
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

it.each([
  ["a frame that is not JSON", "not json", 1008],
  ["a frame that is no request", JSON.stringify({ id: 1 }), 1008],
  [
    "a request that names no Tab",
    JSON.stringify({ id: 1, method: "look" }),
    1008,
  ],
  [
    "a request whose id is neither text nor a number",
    JSON.stringify({ id: { n: 1 }, method: "look", tab: 1 }),
    1008,
  ],
  [
    "a request whose method is not text",
    JSON.stringify({ id: 1, method: 7, tab: 1 }),
    1008,
  ],
  [
    "a request whose method is empty",
    JSON.stringify({ id: 1, method: "", tab: 1 }),
    1008,
  ],
  [
    "a binary frame",
    Buffer.from(JSON.stringify({ id: 1, method: "look", tab: 1 })),
    1008,
  ],
  ["a frame larger than any request", "x".repeat(2 * 1024 * 1024), 1009],
] as const)(
  "closes a window that sends %s, and goes on serving another window",
  async (_, frame, code) => {
    const { socket } = await serve();
    const bad = await windowSocket(socket);

    bad.socket.send(frame);

    const [closed, reason] = (await once(bad.socket, "close")) as [
      number,
      Buffer,
    ];
    expect(closed).toBe(code);
    if (code === 1008) expect(String(reason)).toBe("Not an Inspector request.");
    const healthy = await windowSocket(socket);
    expect(await healthy.request("getState")).toEqual({
      id: 1,
      result: "getState",
    });
  }
);

it("closes a window that stops reading once what it left unread outgrows its bound", async () => {
  const { socket, browser } = await serve();
  const window = await windowSocket(socket);
  expect(await window.request("subscribe")).toEqual({ id: 1, result: null });
  await expect.poll(() => browser.inspectorListeners).toBe(1);
  // The window's own end of the connection stops reading.
  const connection = (window.socket as unknown as { _socket: Socket })._socket;
  connection.pause();

  const told = 40;
  for (let event = 0; event < told; event += 1)
    browser.tellInspector({ event, padding: "x".repeat(1024 * 1024) });
  const closed = once(window.socket, "close");
  connection.resume();

  await closed;
  expect(
    window.told.filter((frame) => Object.hasOwn(frame, "event")).length
  ).toBeLessThan(told);
});

it("answers a window's call with what the contract of the Session's Tab answered, and an error with why", async () => {
  const { address, socket, browser } = await serve();
  const window = await windowSocket(socket, new URL(address).origin);

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

it("answers a request whose id is text with that id", async () => {
  const { socket } = await serve();
  const window = await windowSocket(socket);
  await expect.poll(() => window.told).toContainEqual({ tab: 1 });

  window.socket.send(JSON.stringify({ id: "a", method: "getState", tab: 1 }));

  await expect
    .poll(() => window.told)
    .toContainEqual({ id: "a", result: "getState" });
});

it("tells the contract's events only to a window that subscribed and has not unsubscribed since, and goes on telling every window its Tabs", async () => {
  const { socket, browser } = await serve();
  const subscribed = await windowSocket(socket);
  const unsubscribed = await windowSocket(socket);
  const never = await windowSocket(socket);
  await subscribed.request("subscribe");
  await unsubscribed.request("subscribe");
  expect(await unsubscribed.request("unsubscribe")).toEqual({
    id: 2,
    result: null,
  });
  await expect.poll(() => browser.inspectorListeners).toBe(1);

  browser.tellInspector({ type: "state" });
  browser.openTab("http://127.0.0.1:5173/other");

  const unasked = (window: { told: object[] }) =>
    window.told.filter((frame) => !Object.hasOwn(frame, "id"));
  await expect
    .poll(() => unasked(subscribed))
    .toEqual([{ tab: 1 }, { event: { type: "state" } }, { tab: 2 }]);
  for (const window of [unsubscribed, never])
    await expect.poll(() => unasked(window)).toEqual([{ tab: 1 }, { tab: 2 }]);
});

it("tells a window the Tab it shows, the contract's events once it subscribed, and each new Tab, which its calls name", async () => {
  const { socket, browser } = await serve();
  const window = await windowSocket(socket);

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
  const { socket, browser, session } = await serve();
  const window = await windowSocket(socket);
  await window.request("subscribe");
  await expect.poll(() => browser.inspectorListeners).toBe(1);

  window.socket.close();

  await expect.poll(() => browser.inspectorListeners).toBe(0);
  expect(await Effect.runPromise(session.ask({ tools: {} }))).toMatchObject({
    ok: true,
  });
});

it("closing one of two windows keeps the subscription to the Tab's contract, which ends the windows' highlights only with the last", async () => {
  const { socket, browser } = await serve();
  const first = await windowSocket(socket);
  const second = await windowSocket(socket);
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
  const { socket, browser } = await serve();
  const window = await windowSocket(socket);
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
  const { socket, session } = await serve();
  const window = await windowSocket(socket);
  await window.request("subscribe");
  const closed = once(window.socket, "close");

  await Effect.runPromise(session.ask({ stop: {} }));

  await closed;
  expect(window.told.at(-1)).toEqual({
    ended:
      "The Session shop was closed. Start a Session with ayme -s=shop open or ayme -s=shop attach, then run ayme -s=shop inspect to inspect it.",
    inChat:
      "The Session shop was closed. Start a Session with ayme -s=shop open or ayme -s=shop attach, then ask your agent to show the Inspector again.",
  });
});

describe("closing, within the one limit of how long it waits for the windows", () => {
  it("closes each window that reads its socket with the closing handshake, without waiting for the limit", async () => {
    const { socket, close } = await serve();
    const window = await windowSocket(socket);
    const closed = once(window.socket, "close");

    const started = Date.now();
    await close();

    // ws tells a close without a code as 1005, and a connection cut
    // without the handshake as 1006.
    expect(((await closed) as [number])[0]).toBe(1005);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("answers a request that arrives while it closes with why, and ends its connection, and takes no socket", async () => {
    const made = realpathSync(mkdtempSync(join(tmpdir(), "ayme-window-")));
    onTestFinished(() => rmSync(made, { recursive: true, force: true }));
    const { script, release } = heldScript(made);
    const window = await serveInspectorWindow({
      name: "shop",
      script,
      started: Effect.succeed({
        ask: () => Effect.never,
        events: Stream.never,
      }),
    });
    onTestFinished(() => window.close());
    const stuck = new WebSocket(window.agentAppSocket);
    onTestFinished(() => stuck.terminate());
    await once(stuck, "open");
    // A window that stops reading keeps the closing going until the limit.
    (stuck as unknown as { _socket: Socket })._socket.pause();
    const { host, port } = new URL(window.address);
    // Connections that closing does not end at once: each waits for the
    // script.
    const connections = await Promise.all(
      [0, 1].map(async () => {
        const held = connect(Number(port), "127.0.0.1");
        onTestFinished(() => void held.destroy());
        held.on("error", () => {});
        await once(held, "connect");
        let told = "";
        held.on("data", (data) => (told += String(data)));
        held.write(
          `GET /inspector/external.mjs HTTP/1.1\r\nHost: ${host}\r\n\r\n`
        );
        const ended = new Promise((resolve) => held.once("close", resolve));
        return { held, told: () => told, ended };
      })
    );
    const [page, upgrade] = connections as [
      (typeof connections)[0],
      (typeof connections)[0],
    ];
    await new Promise((resolve) => setTimeout(resolve, 50));

    const closing = window.close();
    page.held.write(`GET /inspector HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
    const { pathname, search } = new URL(window.agentAppSocket);
    upgrade.held.write(
      `GET ${pathname}${search} HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${Buffer.alloc(16).toString("base64")}\r\n\r\n`
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await Promise.all([page.ended, upgrade.ended]);

    const [, ending] = page.told().split(/(?=HTTP\/1\.1 )/);
    expect(ending).toMatch(/^HTTP\/1\.1 503 /);
    expect(ending).toMatch(/\r\nconnection: close\r\n/i);
    expect(ending).toMatch(/\r\ncontent-type: text\/plain\r\n/i);
    expect(ending).toContain("The Session is ending.");
    expect(upgrade.told()).not.toContain("101 Switching Protocols");
    await closing;
  });

  it("takes no window that connects while a window that does not read its socket drains, and still ends", async () => {
    const window = await serveInspectorWindow({
      name: "shop",
      script: "",
      started: Effect.succeed({
        ask: () => Effect.never,
        events: Stream.never,
      }),
    });
    onTestFinished(() => window.close());
    const stuck = new WebSocket(window.agentAppSocket);
    onTestFinished(() => stuck.terminate());
    await once(stuck, "open");
    // A window that stops reading never answers the close.
    (stuck as unknown as { _socket: Socket })._socket.pause();

    const closing = window.close();
    const late = new WebSocket(window.agentAppSocket);
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
