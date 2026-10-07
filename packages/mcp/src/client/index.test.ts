import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Pairing } from "../pairing";

const channels = vi.hoisted(
  () =>
    [] as {
      onWelcome(welcome: { token?: string }): void;
      onDisconnected(): void;
      onUnknownPairing(): void;
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
      options?: { lookNow?: boolean }
    ) => {
      sourceStarts.push({ onPairing, lookNow: options?.lookNow });
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

describe("startAgentConnection's App Process tools", () => {
  const jobs = { name: "peek.node.jobs", description: "", inputSchema: {} };

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
