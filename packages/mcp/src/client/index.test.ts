import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Pairing } from "../pairing";

const channels = vi.hoisted(
  () =>
    [] as {
      onWelcome(welcome: { token?: string }): void;
      onDisconnected(): void;
    }[]
);
const sourceStarts = vi.hoisted(() => [] as ((pairing: Pairing) => void)[]);

vi.mock("../connection", () => ({
  openPageChannel: (
    _url: () => string,
    callbacks: (typeof channels)[number]
  ) => {
    channels.push(callbacks);
    return { close() {} };
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
    (onPairing: (pairing: Pairing) => void) => {
      sourceStarts.push(onPairing);
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
  it("looks for a server again when a busy server refuses its pairing without a token", () => {
    startAgentConnection({ tools: {} as never });
    sourceStarts[0]!({ address: ADDRESS, token: "" });

    channels[0]!.onWelcome({});
    channels[0]!.onDisconnected();

    expect(sourceStarts).toHaveLength(2);
  });

  it("stays unpaired when another tab takes the server it had a token for", () => {
    startAgentConnection({ tools: {} as never });
    sourceStarts[0]!({ address: ADDRESS, token: "" });

    channels[0]!.onWelcome({ token: "handed-over" });
    channels[0]!.onDisconnected();

    expect(sourceStarts).toHaveLength(1);
  });
});
