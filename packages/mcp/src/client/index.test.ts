import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotConnectedReason, Pairing } from "../pairing";

const channels = vi.hoisted(
  () =>
    [] as {
      onWelcome(welcome: { token?: string; agent?: string }): void;
      onDisconnected(): void;
      onUnknownPairing(): void;
      onLost(): void;
      /** Sends the page the App Processes' tools, as the server does. */
      sendProcessTools(tools: { name: string }[]): void;
      /** How the server answers the next call to an App Process's tool. */
      answer: unknown;
      processCalls: { name: string; input: unknown }[];
      closed: boolean;
    }[]
);
const sourceStarts = vi.hoisted(
  () =>
    [] as {
      onPairing: (pairing: Pairing) => void;
      lookNow: boolean | undefined;
      onUnpaired?: (reason: NotConnectedReason) => void;
    }[]
);

vi.mock("../connection", () => ({
  openPageChannel: (
    _url: () => string,
    callbacks: (typeof channels)[number]
  ) => {
    const listeners = new Set<(tools: { name: string }[]) => void>();
    const channel = Object.assign(callbacks, {
      sendProcessTools(tools: { name: string }[]) {
        for (const listener of listeners) listener(tools);
      },
      answer: undefined as unknown,
      processCalls: [] as { name: string; input: unknown }[],
      closed: false,
    });
    channels.push(channel);
    return {
      followProcessTools(listener: (tools: { name: string }[]) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      async callProcessTool(name: string, input: unknown) {
        channel.processCalls.push({ name, input });
        return channel.answer;
      },
      close() {
        channel.closed = true;
      },
    };
  },
}));
vi.mock("../pairing", () => ({
  forgetStoredPairing() {},
  socketUrl: ({ address, token }: Pairing) => `${address}/${token}`,
  storePairing() {},
  storedTabId: () => "tab",
}));
vi.mock("./clientBehaviours", () => ({ clientBehaviours: [] }));
vi.mock("./pairingSources", () => ({
  pairingSources: [
    (
      onPairing: (pairing: Pairing) => void,
      options?: {
        lookNow?: boolean;
        onUnpaired?: (reason: NotConnectedReason) => void;
      }
    ) => {
      sourceStarts.push({
        onPairing,
        lookNow: options?.lookNow,
        onUnpaired: options?.onUnpaired,
      });
      return () => {};
    },
  ],
}));

const { startAgentConnection } = await import("./index");

const ADDRESS = "ws://127.0.0.1:9350";

beforeEach(() => {
  channels.length = 0;
  sourceStarts.length = 0;
  vi.stubGlobal("window", {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startAgentConnection", () => {
  it("looks for a server again from the tab's next focus when a busy server refuses its pairing without a token", () => {
    startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "" });

    channels[0]!.onWelcome({});
    channels[0]!.onDisconnected();

    expect(sourceStarts.map(({ lookNow }) => lookNow)).toEqual([true, false]);
  });

  it("stays unpaired when another tab takes the server it had a token for", () => {
    startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "" });

    channels[0]!.onWelcome({ token: "handed-over" });
    channels[0]!.onDisconnected();

    expect(sourceStarts).toHaveLength(1);
  });
});

describe("startAgentConnection's status", () => {
  it("is not connected, without a reason, before it learns one", () => {
    const { status } = startAgentConnection({ tools: {} as never });

    expect(status.get()).toEqual({ state: "not-connected" });
  });

  it("says why a look for a server did not pair the tab", () => {
    const { status } = startAgentConnection({ tools: {} as never });

    sourceStarts[0]!.onUnpaired!("several-servers");

    expect(status.get()).toEqual({
      state: "not-connected",
      reason: "several-servers",
    });
  });

  it("is connecting once it pairs, and connected with the agent's name once the server welcomes it", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    const heard: unknown[] = [];
    status.subscribe((next) => heard.push(next));

    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });
    channels[0]!.onWelcome({ agent: "claude-code" });

    expect(heard).toEqual([
      { state: "not-connected", reason: "connecting" },
      { state: "connected", agent: "claude-code" },
    ]);
  });

  it("is connected without a name when the server has none", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });

    channels[0]!.onWelcome({});

    expect(status.get()).toEqual({ state: "connected" });
  });

  it("is not connected while the server it paired with stops answering, and connected again once it answers", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });
    channels[0]!.onWelcome({});

    channels[0]!.onLost();
    expect(status.get()).toEqual({
      state: "not-connected",
      reason: "no-answer",
    });

    channels[0]!.onWelcome({});
    expect(status.get()).toEqual({ state: "connected" });
  });

  it.each([
    ["another tab takes its server", "token"],
    ["a busy server refuses its pairing without a token", ""],
  ])("says the agent works in another tab when %s", (_case, token) => {
    const { status } = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token });
    channels[0]!.onWelcome({});

    channels[0]!.onDisconnected();

    expect(status.get()).toEqual({
      state: "not-connected",
      reason: "other-tab",
    });
  });

  it("ignores a look that did not pair while the tab is paired", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });
    channels[0]!.onWelcome({});

    sourceStarts[0]!.onUnpaired!("no-server");

    expect(status.get()).toEqual({ state: "connected" });
  });

  it("tells its subscribers of a change only, until they unsubscribe", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    const heard: unknown[] = [];
    const unsubscribe = status.subscribe((next) => heard.push(next));

    sourceStarts[0]!.onUnpaired!("no-server");
    sourceStarts[0]!.onUnpaired!("no-server");
    unsubscribe();
    sourceStarts[0]!.onUnpaired!("several-servers");

    expect(heard).toEqual([{ state: "not-connected", reason: "no-server" }]);
  });

  it("ignores the channel it paired before once it pairs with another server", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });
    sourceStarts[0]!.onPairing({ address: "ws://127.0.0.1:9351", token: "t" });

    channels[0]!.onWelcome({ agent: "claude-code" });
    channels[0]!.onLost();
    expect(status.get()).toEqual({
      state: "not-connected",
      reason: "connecting",
    });

    channels[1]!.onWelcome({});
    channels[0]!.onLost();
    expect(status.get()).toEqual({ state: "connected" });
  });

  it("forgets its reason when the server does not know its pairing, and looks again", () => {
    const { status } = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });

    channels[0]!.onUnknownPairing();

    expect(status.get()).toEqual({ state: "not-connected" });
    expect(sourceStarts).toHaveLength(2);
  });
});

describe("startAgentConnection's App Process tools", () => {
  const jobs = {
    name: "peek.node.jobs",
    description: "",
    inputSchema: {},
    available: true,
  };

  const pairedConnection = () => {
    const connection = startAgentConnection({ tools: {} as never });
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });
    return connection;
  };

  it("lists the App Processes' tools the paired server sends, and tells its subscribers", () => {
    const connection = pairedConnection();
    const heard: string[][] = [];
    connection.processTools.subscribe((tools) =>
      heard.push(tools.map(({ name }) => name))
    );

    channels[0]!.sendProcessTools([jobs]);

    expect(connection.processTools.list()).toEqual([jobs]);
    expect(heard).toEqual([["peek.node.jobs"]]);
  });

  it("lists none before it pairs, and none once its channel ends", () => {
    const connection = startAgentConnection({ tools: {} as never });
    expect(connection.processTools.list()).toEqual([]);
    sourceStarts[0]!.onPairing({ address: ADDRESS, token: "token" });
    channels[0]!.sendProcessTools([jobs]);

    channels[0]!.onUnknownPairing();

    expect(connection.processTools.list()).toEqual([]);
  });

  it("runs an App Process's tool through the server and resolves with its result", async () => {
    const connection = pairedConnection();
    channels[0]!.answer = { callId: "1", ok: true, result: { value: 1 } };

    const result = await connection.processTools.run("peek.node.jobs", {});

    expect(result).toEqual({ value: 1 });
    expect(channels[0]!.processCalls).toEqual([
      { name: "peek.node.jobs", input: {} },
    ]);
  });

  it("throws the error the App Process's tool failed with", async () => {
    const connection = pairedConnection();
    channels[0]!.answer = { callId: "1", ok: false, error: "No such Peek." };

    await expect(
      connection.processTools.run("peek.node.jobs", {})
    ).rejects.toThrow("No such Peek.");
  });

  it("throws when it runs one while no server is paired", async () => {
    const connection = startAgentConnection({ tools: {} as never });

    await expect(
      connection.processTools.run("peek.node.jobs", {})
    ).rejects.toThrow("No Ayme MCP server is paired with this tab.");
  });
});
