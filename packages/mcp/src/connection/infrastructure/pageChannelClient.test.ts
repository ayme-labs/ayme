import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { DISCONNECTED_CLOSE_CODE } from "../../contract";
import type { PageChannel } from "../application/behaviours";
import { openPageChannel } from "./pageChannelClient";

/** The tRPC request a frame from the page carries. */
type Request = {
  id: number | string;
  method: string;
  params?: { path?: string };
};

let server: WebSocketServer | undefined;
let channel: PageChannel | undefined;

afterEach(async () => {
  channel?.close();
  for (const socket of server?.clients ?? []) socket.terminate();
  await new Promise((resolve) => server?.close(resolve));
});

/**
 * A server that records the procedures the page calls, in the order their
 * frames arrive, and sends `call` once the page subscribes to calls. It
 * listens on `port`, or on a free one.
 */
async function startServer(call: object, port = 0) {
  const paths: string[] = [];
  server = new WebSocketServer({ port });
  server.on("connection", (socket: WebSocket) =>
    socket.on("message", (data) => {
      const parsed = JSON.parse(String(data)) as Request | Request[];
      for (const request of [parsed].flat()) {
        const path = request.params?.path ?? request.method;
        paths.push(path);
        if (path === "calls")
          socket.send(
            JSON.stringify({
              id: request.id,
              result: { type: "data", data: call },
            })
          );
      }
    })
  );
  await new Promise((resolve) => server!.once("listening", resolve));
  const { port: listening } = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${listening}`, port: listening, paths };
}

describe("openPageChannel", () => {
  it("reports tools that changed during a call before the call's answer", async () => {
    const { url, paths } = await startServer({
      callId: "call-1",
      name: "click",
      input: {},
    });
    channel = openPageChannel(() => url, {
      hello: () => ({ tab: "tab-1", url: "http://127.0.0.1/" }),
      onWelcome: () => {},
      onDisconnected: () => {},
      onUnknownPairing: () => {},
      onClose: () => {},
    });
    // tRPC opens the socket for its first request.
    void channel.publishTools([]).catch(() => {});
    await expect.poll(() => paths).toContain("publishTools");

    channel.answerCalls(async ({ callId }) => {
      // As a Run's last availability probe does, right before it answers.
      void channel!.publishTools([
        {
          name: "Basket.readHeading",
          description: "",
          inputSchema: {},
          available: true,
        },
      ]);
      return { callId, ok: true as const, result: "done" };
    });

    await expect.poll(() => paths).toContain("answer");
    const answered = paths.lastIndexOf("answer");
    expect(paths.lastIndexOf("publishTools")).toBeLessThan(answered);
  });

  it("says it lost the server when its socket closes, and keeps reconnecting", async () => {
    const { url } = await startServer({});
    let connections = 0;
    server!.on("connection", (socket: WebSocket) => {
      connections += 1;
      if (connections === 1) socket.close(1001);
    });
    let lost = 0;
    channel = openPageChannel(() => url, {
      hello: () => ({ tab: "tab-1", url: "http://127.0.0.1/" }),
      onWelcome: () => {},
      onDisconnected: () => {},
      onUnknownPairing: () => {},
      onLost: () => (lost += 1),
    });
    void channel.publishTools([]).catch(() => {});

    await expect.poll(() => lost).toBe(1);
    await expect.poll(() => connections, { timeout: 5000 }).toBe(2);
  });

  it("reconnects within 2 s of a server coming back after a long wait", async () => {
    const { url, port } = await startServer({});
    let attempts = 0;
    class CountingWebSocket extends globalThis.WebSocket {
      constructor(address: string | URL) {
        super(address);
        attempts += 1;
      }
    }
    channel = openPageChannel(() => url, {
      hello: () => ({ tab: "tab-1", url: "http://127.0.0.1/" }),
      onWelcome: () => {},
      onDisconnected: () => {},
      onUnknownPairing: () => {},
      WebSocket: CountingWebSocket,
    });
    void channel.publishTools([]).catch(() => {});
    await expect.poll(() => attempts).toBe(1);

    // The server goes away, and the channel fails to reconnect until its
    // delays have reached the cap: the next one is 2 s, where tRPC's default
    // would be 30 s and an uncapped 500 ms step 3 s.
    for (const socket of server!.clients) socket.terminate();
    await new Promise((resolve) => server!.close(resolve));
    await expect.poll(() => attempts, { timeout: 9000 }).toBeGreaterThan(6);

    const returned = await startServer({}, port);
    await expect
      .poll(() => returned.paths, { timeout: 2500 })
      .toContain("hello");
  }, 15_000);

  it("says another tab took the server, not that it lost it, when the server says so", async () => {
    const { url } = await startServer({});
    server!.on("connection", (socket: WebSocket) =>
      socket.close(DISCONNECTED_CLOSE_CODE, "Another tab connected.")
    );
    let lost = 0;
    let disconnected = 0;
    channel = openPageChannel(() => url, {
      hello: () => ({ tab: "tab-1", url: "http://127.0.0.1/" }),
      onWelcome: () => {},
      onDisconnected: () => (disconnected += 1),
      onUnknownPairing: () => {},
      onLost: () => (lost += 1),
    });
    void channel.publishTools([]).catch(() => {});

    await expect.poll(() => disconnected).toBe(1);
    expect(lost).toBe(0);
  });
});
