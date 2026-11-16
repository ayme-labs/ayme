import type { AddressInfo } from "node:net";

import { afterEach, expect, it } from "vitest";

import {
  AgentConnection,
  createPageChannelServer,
  openPageChannel,
  type InspectorPort,
  type PageChannel,
} from "../../connection";
import { serveInspector } from "./serveInspector";

let stop: (() => void) | undefined;
const channels: PageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  stop?.();
});

/** A server and a page paired with it, whose Inspector is `inspector`. */
async function pairedPage(inspector: InspectorPort) {
  const connection = new AgentConnection();
  const { server, close } = createPageChannelServer({
    connection,
    token: "token",
    agent: () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stop = close;
  const { port } = server.address() as AddressInfo;
  const channel = openPageChannel(() => `ws://127.0.0.1:${port}/token`, {
    hello: () => ({ tab: "tab-1", url: "http://127.0.0.1/" }),
    onWelcome: () => {},
    onDisconnected: () => {},
    onUnknownPairing: () => {},
  });
  channels.push(channel);
  const stopServing = serveInspector({
    tools: { list: () => [], subscribe: () => () => {}, run: async () => null },
    channel,
    inspector,
  });
  await expect.poll(() => connection.inspectorLink).toBeDefined();
  return { connection, stopServing };
}

it("runs each request on the page's Inspector port, started in the order it was sent", async () => {
  const started: string[] = [];
  const { connection } = await pairedPage({
    request: (method, params) => {
      started.push(method);
      return Promise.resolve({ method, params });
    },
    subscribe: () => () => {},
  });
  const link = connection.inspectorLink!;

  const answers = await Promise.all([
    link.request("pick", { id: "p1", refs: ["e1"] }),
    link.request("cancelPick", { id: "p1" }),
  ]);

  expect(started).toEqual(["pick", "cancelPick"]);
  expect(answers).toEqual([
    { method: "pick", params: { id: "p1", refs: ["e1"] } },
    { method: "cancelPick", params: { id: "p1" } },
  ]);
});

it("answers a request the port fails, or throws on, with its message", async () => {
  const { connection } = await pairedPage({
    request: (method) => {
      if (method === "throws") throw new Error("thrown");
      return Promise.reject(new Error("rejected"));
    },
    subscribe: () => () => {},
  });
  const link = connection.inspectorLink!;

  await expect(link.request("throws", {})).rejects.toThrow("thrown");
  await expect(link.request("rejects", {})).rejects.toThrow("rejected");
});

it("pushes the port's events to the server from `subscribe` until `unsubscribe`", async () => {
  let push: (event: unknown) => void = () => {};
  let stops = 0;
  const { connection } = await pairedPage({
    request: async () => null,
    subscribe(listener) {
      push = listener;
      return () => void stops++;
    },
  });
  const link = connection.inspectorLink!;
  const heard: unknown[] = [];
  link.onEvent((event) => heard.push(event));

  await link.request("subscribe", undefined);
  await link.request("subscribe", undefined);
  push({ type: "state", state: { revision: 1 } });
  await expect.poll(() => heard).toHaveLength(1);
  await link.request("unsubscribe", undefined);

  expect(heard).toEqual([{ type: "state", state: { revision: 1 } }]);
  expect(stops).toBe(1);
});

it("stops the port's events when the page stops serving", async () => {
  let stops = 0;
  const { connection, stopServing } = await pairedPage({
    request: async () => null,
    subscribe: () => () => void stops++,
  });
  await connection.inspectorLink!.request("subscribe", undefined);

  stopServing();

  expect(stops).toBe(1);
});

it("serves nothing without an Inspector port", async () => {
  const { stopServing } = await pairedPage(undefined as never);
  expect(() => stopServing()).not.toThrow();
});
