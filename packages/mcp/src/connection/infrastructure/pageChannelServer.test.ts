import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { PageTool } from "../../contract";
import { AgentConnection } from "../application/agentConnection";
import type { PageChannel } from "../application/behaviours";
import { openPageChannel } from "./pageChannelClient";
import { createPageChannelServer } from "./pageChannelServer";

const CLICK: PageTool = {
  name: "click",
  description: "",
  inputSchema: {},
  available: true,
};

let stop: (() => void) | undefined;
const channels: PageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  stop?.();
});

async function startServer() {
  const connection = new AgentConnection();
  const { server, close } = createPageChannelServer({
    connection,
    token: "token",
    agent: () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stop = close;
  const { port } = server.address() as AddressInfo;
  return { connection, url: `ws://127.0.0.1:${port}/token` };
}

/**
 * A page of the tab `tab-1` that offers `tools` and answers its calls with
 * `run`.
 */
function openPage(
  url: string,
  run: () => Promise<unknown>,
  tools: PageTool[] = [CLICK]
) {
  const channel = openPageChannel(() => url, {
    hello: () => ({ tab: "tab-1", url: "http://127.0.0.1/" }),
    onWelcome: () => {},
    onDisconnected: () => {},
    onUnknownPairing: () => {},
  });
  channels.push(channel);
  channel.answerCalls(async ({ callId }) => ({
    callId,
    ok: true,
    result: await run(),
  }));
  void channel.publishTools(tools);
  return channel;
}

it("sends the tab's calls to its new channel after the old one closed during a call", async () => {
  const { connection, url } = await startServer();
  let finish!: (result: string) => void;
  const first = openPage(
    url,
    () => new Promise((resolve) => (finish = resolve))
  );
  await expect.poll(() => connection.offers("click")).toBe(true);
  const running = connection.call("click", {});
  await expect.poll(() => finish).toBeDefined();

  // As when the page's Ayme setup is disposed and started again while a
  // tool runs, in the same document.
  first.close();
  openPage(url, async () => "from the new channel", [
    CLICK,
    { ...CLICK, name: "onlyOnTheNewChannel" },
  ]);
  // The new channel paired before the old one's call ends.
  await expect.poll(() => connection.offers("onlyOnTheNewChannel")).toBe(true);
  finish("from the old channel");
  await running;
  // Time for a closed channel that answers on a reopened socket to say
  // hello again, as the tab's page.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const next = await Promise.race([
    connection.call("click", {}),
    new Promise((resolve) => setTimeout(() => resolve("no answer"), 3000)),
  ]);
  expect(next).toMatchObject({ ok: true, result: "from the new channel" });
});

describe("the Inspector link of the paired page", () => {
  /** A page that answers each Inspector request with its method, in order. */
  function openInspectedPage(url: string, received: string[] = []) {
    const channel = openPage(url, async () => "unused");
    channel.serveInspector(async ({ id, method }) => {
      received.push(method);
      return { id, ok: true, result: `answer to ${method}` };
    });
    return channel;
  }

  it("sends the server's requests to the page in order and returns its answers", async () => {
    const { connection, url } = await startServer();
    const received: string[] = [];
    openInspectedPage(url, received);
    await expect.poll(() => connection.inspectorLink).toBeDefined();
    const link = connection.inspectorLink!;

    const answers = await Promise.all(
      ["pick", "cancelPick", "highlight"].map((method) =>
        link.request(method, {})
      )
    );

    expect(received).toEqual(["pick", "cancelPick", "highlight"]);
    expect(answers).toEqual([
      "answer to pick",
      "answer to cancelPick",
      "answer to highlight",
    ]);
  });

  it("rejects a request the page fails", async () => {
    const { connection, url } = await startServer();
    const channel = openPage(url, async () => "unused");
    channel.serveInspector(async ({ id }) => ({
      id,
      ok: false,
      error: "no such command",
    }));
    await expect.poll(() => connection.inspectorLink).toBeDefined();

    await expect(connection.inspectorLink!.request("x", {})).rejects.toThrow(
      "no such command"
    );
  });

  it("hears the events the page pushes", async () => {
    const { connection, url } = await startServer();
    const channel = openInspectedPage(url);
    await expect.poll(() => connection.inspectorLink).toBeDefined();
    const heard: unknown[] = [];
    connection.inspectorLink!.onEvent((event) => heard.push(event));

    await channel.sendInspectorEvent({ type: "state", state: { revision: 3 } });

    await expect
      .poll(() => heard)
      .toEqual([{ type: "state", state: { revision: 3 } }]);
  });

  it("rejects the requests still waiting when the page leaves", async () => {
    const { connection, url } = await startServer();
    const channel = openPage(url, async () => "unused");
    channel.serveInspector(() => new Promise(() => {}));
    await expect.poll(() => connection.inspectorLink).toBeDefined();
    const waiting = connection.inspectorLink!.request("pick", {});
    const rejected = expect(waiting).rejects.toThrow("page left");

    channel.close();

    await rejected;
  });
});
