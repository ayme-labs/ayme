import { mkdtemp, writeFile } from "node:fs/promises";
import { request, type RequestOptions } from "node:http";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCUntypedClient, createWSClient, wsLink } from "@trpc/client";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { RecorderUpdate } from "../../contract";
import {
  serveWindow,
  type WindowServer,
  type WindowTarget,
} from "./windowServer";

// The window's server on its own, with a stand-in for the recorder: who may
// talk to it, what it answers, and how it closes.

const update = (revision: number) =>
  ({
    revision,
    state: { phase: "notRecording", visits: [], commands: ["record"] },
  }) as unknown as RecorderUpdate;

/** A stand-in for the recorder's handle, which says who listens to it. */
function standIn() {
  const listeners = new Set<(update: RecorderUpdate) => void>();
  let newest = update(1);
  const target: WindowTarget = {
    send: () => Promise.resolve("applied"),
    subscribe(listener) {
      listeners.add(listener);
      listener(newest);
      return () => listeners.delete(listener);
    },
  };
  return {
    target,
    listeners,
    publish(revision: number) {
      newest = update(revision);
      for (const listener of listeners) listener(newest);
    },
  };
}

const ends: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const end of ends.splice(0).reverse()) await end();
});

/** A server for a folder of stand-in window files. */
async function serve(): Promise<WindowServer & { port: number }> {
  const folder = await mkdtemp(join(tmpdir(), "ayme-recorder-window-"));
  await writeFile(join(folder, "index.html"), "<!doctype html><p>window");
  await writeFile(join(folder, "data.bin"), "bytes");
  const server = await serveWindow(folder);
  ends.push(() => server.close());
  return { ...server, port: Number(new URL(server.url).port) };
}

type Answer = { status: number; type?: string; body: string };

/** A GET over a connection of the test's own. */
function get(port: number, options: RequestOptions = {}) {
  return new Promise<Answer>((resolve, reject) => {
    const sent = request(
      { host: "127.0.0.1", port, path: "/", ...options },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            type: response.headers["content-type"],
            body,
          })
        );
      }
    );
    sent.on("error", reject);
    sent.end();
  });
}

/** Asks to upgrade to a WebSocket at `path`, and resolves with the first
 * line of the answer. */
function upgrade(port: number, path: string, headers: Record<string, string>) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () =>
      socket.write(
        `GET ${path} HTTP/1.1\r\n${Object.entries(headers)
          .map(([name, value]) => `${name}: ${value}\r\n`)
          .join(
            ""
          )}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`
      )
    );
    let answer = "";
    socket.on("data", (chunk: Buffer) => {
      answer += chunk.toString();
      if (!answer.includes("\r\n")) return;
      resolve(answer.split("\r\n")[0]!);
      socket.destroy();
    });
    socket.on("error", reject);
  });
}

/** A window's subscription to the server's channel. */
function subscribe(port: number) {
  const socket = createWSClient({
    url: `ws://127.0.0.1:${port}/channel`,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  const client = createTRPCUntypedClient({
    links: [wsLink({ client: socket })],
  });
  const seen = { updates: [] as number[] };
  const subscription = client.subscription("updates", undefined, {
    onData: (data) => seen.updates.push((data as RecorderUpdate).revision),
  });
  ends.push(() => socket.close());
  return { seen, unsubscribe: () => subscription.unsubscribe() };
}

describe("who the window's server answers", () => {
  it("answers its loopback address, by number or by name, with no origin or its own", async () => {
    const { port } = await serve();
    const window: Answer = {
      status: 200,
      type: "text/html; charset=utf-8",
      body: "<!doctype html><p>window",
    };

    expect(await get(port)).toEqual(window);
    for (const host of [`localhost:${port}`, "127.0.0.1", "localhost"])
      expect(await get(port, { headers: { host } }), host).toEqual(window);
    expect(
      await get(port, { headers: { origin: `http://127.0.0.1:${port}` } })
    ).toEqual(window);
  });

  it("refuses a host that only looks like its loopback address, and any other origin", async () => {
    const { port } = await serve();
    const refused: Answer = {
      status: 403,
      type: "text/plain",
      body: "Not a loopback request.",
    };

    for (const host of [
      "localhost.rebound.example",
      "rebound-localhost",
      `127.0.0.1.rebound.example:${port}`,
      `localhost:${port}x`,
    ])
      expect(await get(port, { headers: { host } }), host).toEqual(refused);
    for (const origin of [
      "http://rebound.example",
      "null",
      `http://localhost:${port}`,
      `https://127.0.0.1:${port}`,
    ])
      expect(await get(port, { headers: { origin } }), origin).toEqual(refused);
  });

  it("refuses a request that names no host", async () => {
    const { port } = await serve();

    const answer = await new Promise<string>((resolve, reject) => {
      // HTTP/1.0 needs no Host header.
      const socket = connect(port, "127.0.0.1", () =>
        socket.write("GET / HTTP/1.0\r\n\r\n")
      );
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += chunk.toString()));
      socket.on("close", () => resolve(text.split("\r\n")[0]!));
      socket.on("error", reject);
    });

    expect(answer).toBe("HTTP/1.1 403 Forbidden");
  });

  it("takes a window's channel only from its loopback address, its own origin, and at its path", async () => {
    const { port } = await serve();
    const host = `127.0.0.1:${port}`;

    expect(await upgrade(port, "/channel", { Host: host })).toBe(
      "HTTP/1.1 101 Switching Protocols"
    );
    expect(
      await upgrade(port, "/channel", {
        Host: host,
        Origin: `http://${host}`,
      })
    ).toBe("HTTP/1.1 101 Switching Protocols");
    expect(
      await upgrade(port, "/channel", { Host: "localhost.rebound.example" })
    ).toBe("HTTP/1.1 403 Forbidden");
    expect(
      await upgrade(port, "/channel", {
        Host: host,
        Origin: "http://rebound.example",
      })
    ).toBe("HTTP/1.1 403 Forbidden");
    expect(await upgrade(port, "/other", { Host: host })).toBe(
      "HTTP/1.1 403 Forbidden"
    );
  });

  const elsewhere = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal);

  it.skipIf(!elsewhere)(
    "listens on the loopback address only, not on the machine's other addresses",
    async () => {
      const { port } = await serve();

      await expect(
        new Promise((resolve, reject) => {
          const socket = connect(port, elsewhere!.address, () => {
            socket.destroy();
            resolve("connected");
          });
          socket.on("error", reject);
        })
      ).rejects.toThrow(/ECONNREFUSED/);
    }
  );
});

describe("what the window's server answers", () => {
  it("says, as plain text, that a path is bad or names nothing it serves", async () => {
    const { port } = await serve();

    expect(await get(port, { path: "/%" })).toEqual({
      status: 400,
      type: "text/plain",
      body: "Bad request.",
    });
    for (const path of ["/missing.js", "/..%2Fsecret"])
      expect(await get(port, { path }), path).toEqual({
        status: 404,
        type: "text/plain",
        body: "Not found.",
      });
  });

  it("serves a file of a kind it does not know as bytes", async () => {
    const { port } = await serve();

    expect(await get(port, { path: "/data.bin" })).toEqual({
      status: 200,
      type: "application/octet-stream",
      body: "bytes",
    });
  });
});

describe("how the window's server closes", () => {
  it("ends each window's subscription once it has its last update", async () => {
    const server = await serve();
    const recorder = standIn();
    server.attach(recorder.target);
    const window = subscribe(server.port);
    await expect.poll(() => window.seen.updates).toEqual([1]);

    recorder.publish(2);
    const started = Date.now();
    await server.close();

    // At once: each window's subscription ends with its last update, so it
    // does not wait out its limit.
    expect(Date.now() - started).toBeLessThan(900);
    expect(window.seen.updates).toEqual([1, 2]);
  });

  it("closes within its limit when a window waits for a recorder that never came", async () => {
    const server = await serve();
    subscribe(server.port);
    // The window's subscription is open, and waits for the recorder.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await server.close();
  });

  it("closes each window's socket and says why", async () => {
    const server = await serve();
    server.attach(standIn().target);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/channel`);
    await new Promise((resolve) => socket.once("open", resolve));
    const closed = new Promise<[number, string]>((resolve) =>
      socket.once("close", (code, reason) => resolve([code, reason.toString()]))
    );

    await server.close();

    expect(await closed).toEqual([1001, "The recorder ended."]);
  });

  it("closes while a program is still sending its request", async () => {
    const server = await serve();
    // A request whose body is still on its way: the server waits for the
    // rest of it.
    const socket = connect(server.port, "127.0.0.1", () =>
      socket.write(
        `POST / HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Length: 100\r\n\r\nhalf`
      )
    );
    socket.on("error", () => {});
    ends.push(async () => socket.destroy());
    await new Promise((resolve) => socket.once("connect", resolve));

    const closing = server.close();

    expect(
      await Promise.race([
        closing.then(() => "closed"),
        new Promise((resolve) =>
          setTimeout(() => resolve("still open"), 2_000)
        ),
      ])
    ).toBe("closed");
  });
});

describe("a window that leaves", () => {
  it("is no longer a listener of the recorder", async () => {
    const server = await serve();
    const recorder = standIn();
    server.attach(recorder.target);
    const window = subscribe(server.port);
    await expect.poll(() => recorder.listeners.size).toBe(1);

    window.unsubscribe();

    await expect.poll(() => recorder.listeners.size).toBe(0);
  });

  it("does no harm when it leaves before the recorder came", async () => {
    const server = await serve();
    const window = subscribe(server.port);
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const recorder = standIn();
    server.attach(recorder.target);

    // It never listens: it left before it could.
    await expect.poll(() => recorder.listeners.size).toBe(0);
    expect((await get(server.port)).status).toBe(200);
  });
});
