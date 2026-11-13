import { mkdtemp, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCUntypedClient, createWSClient, wsLink } from "@trpc/client";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder } from "./testing";

// The window's server: the engine serves the window's built files and a
// tRPC channel over a WebSocket, at a local address.

/** A folder that stands in for the window's built files. */
async function windowFolder() {
  const folder = await mkdtemp(join(tmpdir(), "ayme-recorder-window-"));
  await writeFile(join(folder, "index.html"), "<!doctype html><p>window");
  await writeFile(join(folder, "window.js"), "console.log('window');");
  return folder;
}

/** A GET, with the Host header given or the address's own. */
function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type?: string; body: string }>(
    (resolve, reject) => {
      const req = request(url, { headers }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            type: response.headers["content-type"],
            body,
          })
        );
      });
      req.on("error", reject);
      req.end();
    }
  );
}

const ends: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const end of ends.splice(0)) await end();
});

/** A scripted recorder that serves the window from a folder of its own. */
async function startWithWindow() {
  const started = await startScriptedRecorder({
    window: { folder: await windowFolder() },
  });
  ends.push(() => {
    started.recorder.end();
    return started.recorder.done;
  });
  return { ...started, windowUrl: started.recorder.windowUrl! };
}

/** The window's side of the channel, as the window opens it. */
function channel(windowUrl: string) {
  const socket = createWSClient({
    url: `${windowUrl.replace(/^http/, "ws")}channel`,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  const client = createTRPCUntypedClient({
    links: [wsLink({ client: socket })],
  });
  const updates: RecorderUpdate[] = [];
  const subscription = client.subscription("updates", undefined, {
    onData: (update) => updates.push(update as RecorderUpdate),
  });
  ends.push(async () => {
    subscription.unsubscribe();
    await socket.close();
  });
  return {
    updates,
    send: (type: string) => client.mutation("send", { type }),
    command: (command: object) => client.mutation("send", command),
  };
}

describe("the window's server", () => {
  it("serves the window's files at a local address", async () => {
    const { windowUrl } = await startWithWindow();

    expect(windowUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await get(windowUrl)).toEqual({
      status: 200,
      type: "text/html; charset=utf-8",
      body: "<!doctype html><p>window",
    });
    expect(await get(`${windowUrl}window.js`)).toMatchObject({
      status: 200,
      type: "text/javascript; charset=utf-8",
    });
  });

  it("serves nothing outside the window's folder", async () => {
    const { windowUrl } = await startWithWindow();

    expect((await get(`${windowUrl}missing.js`)).status).toBe(404);
    expect((await get(`${windowUrl}..%2Fpackage.json`)).status).toBe(404);
  });

  it("answers only a request made to its loopback address", async () => {
    const { windowUrl } = await startWithWindow();

    // A page elsewhere that points a name of its own at the address.
    expect((await get(windowUrl, { host: "rebound.example:80" })).status).toBe(
      403
    );
  });

  it("tells the window the full state first, then each change", async () => {
    const { windowUrl } = await startWithWindow();
    const { updates, send } = channel(windowUrl);

    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]!.state).toEqual({
      phase: "notRecording",
      visits: [],
      commands: ["record"],
      warnings: [],
    });

    await expect(send("record")).resolves.toBe("applied");
    await expect.poll(() => updates.at(-1)!.state.visits.length).toBe(1);
    expect(updates.at(-1)!.state.phase).toBe("recording");
    expect(
      updates.every(
        (update, index) =>
          index === 0 || update.revision > updates[index - 1]!.revision
      )
    ).toBe(true);
  });

  it("answers a command that does not apply now with 'ignored'", async () => {
    const { windowUrl } = await startWithWindow();
    const { send } = channel(windowUrl);

    await expect(send("finish")).resolves.toBe("ignored");
  });

  it("refuses a command that is none", async () => {
    const { windowUrl } = await startWithWindow();
    const { send } = channel(windowUrl);

    await expect(send("explode")).rejects.toThrow();
  });

  it("takes Discard and Restore with the entry they name, and refuses them without one", async () => {
    const { windowUrl } = await startWithWindow();
    const { updates, send, command } = channel(windowUrl);

    // Not paused: it reaches the recorder, which answers it.
    await expect(
      command({ type: "discard", entry: "interaction_1" })
    ).resolves.toBe("ignored");
    await send("record");
    await send("stop");
    await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");
    await expect(
      command({ type: "discard", entry: "interaction_1" })
    ).resolves.toBe("applied");
    await expect(
      command({ type: "restore", entry: "interaction_1" })
    ).resolves.toBe("applied");
    await expect(command({ type: "discard" })).rejects.toThrow();
    await expect(command({ type: "restore", entry: 1 })).rejects.toThrow();
  });

  it("gives a window that opens again the full state as it is now", async () => {
    const { windowUrl } = await startWithWindow();
    const first = channel(windowUrl);
    await first.send("record");

    const again = channel(windowUrl);

    await expect.poll(() => again.updates[0]?.state.visits.length).toBe(1);
    expect(again.updates[0]!.state.phase).toBe("recording");
  });

  it("tells the window how the recorder ended before it stops serving", async () => {
    const { recorder, windowUrl } = await startWithWindow();
    const { updates } = channel(windowUrl);
    await expect.poll(() => updates.length).toBe(1);

    recorder.end();
    await recorder.done;

    expect(updates.at(-1)!.state).toMatchObject({
      phase: "ended",
      outcome: { kind: "empty" },
    });
  });

  it("stops serving once the recorder has ended", async () => {
    const { recorder, windowUrl } = await startWithWindow();

    recorder.end();
    await recorder.done;

    await expect(get(windowUrl)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("serves no window when it is given no window's files", async () => {
    const { recorder } = await startScriptedRecorder();

    expect(recorder.windowUrl).toBeNull();
    recorder.end();
    await recorder.done;
  });
});
