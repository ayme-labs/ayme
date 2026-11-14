import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  RecorderCommand,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";
import { initTRPC } from "@trpc/server";
import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { openRecorderChannel } from "./webSocketRecorderChannel";

// The window's channel against a stand-in for the recorder's server: tRPC
// over a WebSocket, with the contract's two procedures, `send` and
// `updates`.

const update = (revision: number) =>
  ({
    revision,
    state: { phase: "notRecording", visits: [], commands: ["record"] },
  }) as unknown as RecorderUpdate;

const ends: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const end of ends.splice(0)) await end();
});

/** A stand-in server: it answers every command "applied", keeps what it was
 * sent, and tells each subscriber the newest update and then each one it
 * is given. */
async function standInServer() {
  const sent: RecorderCommand[] = [];
  let newest = update(1);
  const listeners = new Set<(update: RecorderUpdate) => void>();
  const t = initTRPC.create();
  const router = t.router({
    send: t.procedure
      .input((input) => input as RecorderCommand)
      .mutation(({ input }) => {
        sent.push(input);
        return "applied" as const;
      }),
    updates: t.procedure.subscription(async function* ({ signal }) {
      const heard: RecorderUpdate[] = [newest];
      let wake: (() => void) | undefined;
      const listener = (next: RecorderUpdate) => {
        heard.push(next);
        wake?.();
      };
      listeners.add(listener);
      signal?.addEventListener("abort", () => wake?.());
      try {
        while (!signal?.aborted) {
          const next = heard.shift();
          if (next) yield next;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      } finally {
        listeners.delete(listener);
      }
    }),
  });
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  const handle = getWSConnectionHandler({ wss: sockets, router });
  sockets.on("connection", (ws, request) => handle(ws, request));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  ends.push(
    () =>
      new Promise<void>((resolve) => {
        for (const ws of sockets.clients) ws.terminate();
        sockets.close();
        server.close(() => resolve());
      })
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/channel`,
    sent,
    listeners,
    publish(revision: number) {
      newest = update(revision);
      for (const listener of listeners) listener(newest);
    },
    /** Drops every window's socket, as a server that restarts does. */
    drop() {
      for (const ws of sockets.clients) ws.terminate();
    },
  };
}

describe("the window's channel to the recorder", () => {
  it("sends a command and gives the recorder's answer", async () => {
    const server = await standInServer();
    const channel = openRecorderChannel(server.url);

    await expect(channel.send({ type: "record" })).resolves.toBe("applied");
    expect(server.sent).toEqual([{ type: "record" }]);
  });

  it("tells a subscriber the full state first, then each change, until it unsubscribes", async () => {
    const server = await standInServer();
    const channel = openRecorderChannel(server.url);
    const heard: number[] = [];

    const unsubscribe = channel.subscribe((next) => heard.push(next.revision));
    await expect.poll(() => heard).toEqual([1]);
    server.publish(2);
    await expect.poll(() => heard).toEqual([1, 2]);

    unsubscribe();

    await expect.poll(() => server.listeners.size).toBe(0);
  });

  it("opens its socket again when it drops, and is told the full state again", async () => {
    const server = await standInServer();
    const channel = openRecorderChannel(server.url);
    const heard: number[] = [];
    channel.subscribe((next) => heard.push(next.revision));
    await expect.poll(() => heard).toEqual([1]);

    server.drop();
    server.publish(3);

    await expect.poll(() => heard, { timeout: 3_000 }).toEqual([1, 3]);
  });
});
