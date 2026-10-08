import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

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
 * frames arrive, and sends `call` once the page subscribes to calls.
 */
async function startServer(call: object) {
  const paths: string[] = [];
  server = new WebSocketServer({ port: 0 });
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
  const { port } = server.address() as { port: number };
  return { url: `ws://127.0.0.1:${port}`, paths };
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
        { name: "Basket.readHeading", description: "", inputSchema: {} },
      ]);
      return { callId, ok: true as const, result: "done" };
    });

    await expect.poll(() => paths).toContain("answer");
    const answered = paths.lastIndexOf("answer");
    expect(paths.lastIndexOf("publishTools")).toBeLessThan(answered);
  });
});
