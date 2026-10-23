import type { AddressInfo } from "node:net";

import { afterEach, expect, it } from "vitest";

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
