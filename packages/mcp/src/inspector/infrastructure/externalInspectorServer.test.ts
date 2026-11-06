import { get } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { AgentConnection, createPageChannelServer } from "../../connection";
import { InspectorRelay } from "../application/inspectorRelay";
import { externalInspectorServer } from "./externalInspectorServer";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

async function start(build: string | undefined = "export const build = 1;") {
  const connection = new AgentConnection();
  const relay = new InspectorRelay(connection);
  const extension = externalInspectorServer({
    relay,
    readBuild: async () => build,
  });
  const { server, close } = createPageChannelServer({
    connection,
    token: "token",
    agent: () => undefined,
    extension,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stop = close;
  const { port } = server.address() as AddressInfo;
  return { connection, base: `127.0.0.1:${port}`, port };
}

describe("the external Inspector's page", () => {
  it("serves a page that loads the build's script", async () => {
    const { base } = await start();

    const page = await fetch(`http://${base}/inspector`);
    const script = await fetch(`http://${base}/inspector/external.mjs`);

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain('src="/inspector/external.mjs"');
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(await script.text()).toBe("export const build = 1;");
  });

  it("answers the script with the install hint when the Inspector's package is missing", async () => {
    const { base } = await start(null as never);

    const script = await fetch(`http://${base}/inspector/external.mjs`);

    expect(script.status).toBe(503);
    expect(await script.text()).toContain("@ayme-dev/inspector");
  });

  it("refuses a request for another host name, which a rebinding page would make", async () => {
    const { port } = await start();

    // `fetch` does not let a request choose its Host.
    const status = await new Promise<number | undefined>((resolve) =>
      get(
        {
          host: "127.0.0.1",
          port,
          path: "/inspector",
          headers: { host: `evil.example:${port}` },
        },
        (response) => resolve(response.statusCode)
      )
    );

    expect(status).toBe(403);
  });

  it("leaves other requests to the channel", async () => {
    const { base } = await start();

    const response = await fetch(`http://${base}/other`);

    expect(response.status).toBe(426);
  });
});

describe("the external Inspector's socket", () => {
  const open = (base: string, origin: string | undefined) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://${base}/inspector/ws`,
        origin === undefined ? {} : { origin }
      );
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
      socket.once("unexpected-response", () => reject(new Error("refused")));
    });
  const next = (socket: WebSocket) =>
    new Promise<unknown>((resolve) =>
      socket.once("message", (data) => resolve(JSON.parse(String(data))))
    );

  it("answers a window's request through the relay", async () => {
    const { base } = await start();
    const socket = await open(base, `http://${base}`);

    socket.send(JSON.stringify({ id: 7, method: "getState" }));

    expect(await next(socket)).toEqual({
      id: 7,
      error: expect.stringContaining("No page is connected"),
    });
    socket.close();
  });

  it("refuses a window from another origin", async () => {
    const { base } = await start();

    await expect(open(base, "http://localhost:3000")).rejects.toThrow();
    await expect(open(base, "https://example.com")).rejects.toThrow();
  });

  it("ignores a frame that is no request, and goes on", async () => {
    const { base } = await start();
    const socket = await open(base, `http://${base}`);

    socket.send("not json");
    socket.send(JSON.stringify({ nonsense: true }));
    socket.send(JSON.stringify({ id: 1, method: "getState" }));

    expect(await next(socket)).toMatchObject({ id: 1 });
    socket.close();
  });
});
