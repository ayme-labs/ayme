import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Hello } from "../contract";

/** A channel the App Process opened, which the test drives. */
type FakeChannel = {
  url(): string;
  WebSocket?: unknown;
  hello(): Hello;
  onWelcome(welcome: { token?: string }): void;
  onUnknownPairing(): void;
  onClose?(): void;
  closed: boolean;
  /** Sends the App Process the tools the server hides, as the server does. */
  hide(hidden: string[]): void;
};

const channels = vi.hoisted(() => [] as FakeChannel[]);
/** The scans the App Process started, which the test answers. */
const scans = vi.hoisted(
  () =>
    [] as {
      ports: { first: number; last: number };
      WebSocket: unknown;
      answer(servers: string[]): Promise<void>;
    }[]
);

vi.mock("../connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../connection")>()),
  openPageChannel: (url: () => string, callbacks: FakeChannel) => {
    const hiddenListeners = new Set<(hidden: string[]) => void>();
    const channel: FakeChannel = {
      ...callbacks,
      url,
      closed: false,
      hide(hidden) {
        for (const listener of hiddenListeners) listener(hidden);
      },
    };
    channels.push(channel);
    return {
      publishTools: async () => {},
      answerCalls: () => () => {},
      reportLeaving: async () => {},
      followHiddenTools(listener: (hidden: string[]) => void) {
        hiddenListeners.add(listener);
        return () => hiddenListeners.delete(listener);
      },
      close() {
        channel.closed = true;
      },
    };
  },
}));
vi.mock("../pairing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pairing")>()),
  findServers: (ports: { first: number; last: number }, WebSocket: unknown) =>
    new Promise<string[]>((resolve) =>
      scans.push({
        ports,
        WebSocket,
        async answer(servers) {
          resolve(servers);
          await vi.advanceTimersByTimeAsync(0);
        },
      })
    ),
}));

const { SCAN_INTERVAL_MS, startAgentConnection } = await import("./index");

const SERVER = "ws://127.0.0.1:9352";
const OTHER = "ws://127.0.0.1:9353";
const tool = {
  name: "peek.node.jobs",
  description: "",
  inputSchema: {},
  available: true,
};
const tools = {
  list: () => [tool],
  subscribe: () => () => {},
  run: async () => null,
};

let stops: (() => void)[];
/** Lets the App Process's next lookup or pairing start. */
const settle = () => vi.advanceTimersByTimeAsync(0);
const start = async (options?: Parameters<typeof startAgentConnection>[1]) => {
  const connection = startAgentConnection({ tools }, options);
  stops.push(() => connection.dispose());
  await settle();
  return connection;
};
const openChannels = () => channels.filter(({ closed }) => !closed);

beforeEach(() => {
  vi.useFakeTimers();
  channels.length = 0;
  scans.length = 0;
  stops = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const stop of stops) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startAgentConnection in an App Process", () => {
  it("pairs with the one server that answers on the port range, without a token, saying hello as a process", async () => {
    await start();

    expect(scans.map(({ ports }) => ports)).toEqual([
      { first: 9350, last: 9365 },
    ]);
    await scans[0]!.answer([SERVER]);

    expect(openChannels()).toHaveLength(1);
    expect(channels[0]!.url()).toBe(`${SERVER}/`);
    expect(channels[0]!.hello()).toEqual({ process: expect.any(String) });
  });

  it("stays unpaired while no server or several answer, and scans again every few seconds until one does", async () => {
    await start();
    await scans[0]!.answer([]);
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS - 1);
    expect(scans).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await scans[1]!.answer([SERVER, OTHER]);
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    await scans[2]!.answer([OTHER]);

    expect(SCAN_INTERVAL_MS).toBeLessThanOrEqual(5_000);
    expect(openChannels().map((channel) => channel.url())).toEqual([
      `${OTHER}/`,
    ]);
  });

  it("warns once while several servers answer, naming their ports, and again after it has paired and lost its server", async () => {
    const warn = vi.mocked(console.warn);
    const several =
      "[ayme] Found 2 Ayme MCP servers on ports 9352 and 9353. Pass `link` from the agent's `ayme_connect`, or `port`, to pick one.";
    await start();
    await scans[0]!.answer([SERVER, OTHER]);
    for (const scan of [1, 2, 3]) {
      await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
      await scans[scan]!.answer([SERVER, OTHER]);
    }
    expect(warn).toHaveBeenCalledExactlyOnceWith(several);

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    await scans[4]!.answer([SERVER]);
    channels[0]!.onClose!();
    await settle();
    await scans[5]!.answer([SERVER, OTHER]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn when one server answers or a connect link names one", async () => {
    const warn = vi.mocked(console.warn);
    await start();
    await scans[0]!.answer([SERVER]);
    await start({ link: `http://localhost:5173/#ayme=${SERVER}/f00d` });
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 2);

    expect(warn).not.toHaveBeenCalled();
  });

  it("scans only the port it is given", async () => {
    await start({ port: 41234 });

    expect(scans.map(({ ports }) => ports)).toEqual([
      { first: 41234, last: 41234 },
    ]);
  });

  it("pairs with the server a connect link names, without scanning", async () => {
    await start({ link: `http://localhost:5173/#ayme=${SERVER}/f00d` });

    expect(scans).toEqual([]);
    expect(openChannels().map((channel) => channel.url())).toEqual([
      `${SERVER}/f00d`,
    ]);
  });

  it("refuses a link that is not a connect link", () => {
    expect(() =>
      startAgentConnection({ tools }, { link: "http://localhost:5173/" })
    ).toThrow("Expected a connect link");
  });

  it("scans again after its server goes away, and pairs with the one it finds", async () => {
    await start();
    await scans[0]!.answer([SERVER]);

    channels[0]!.onClose!();

    await settle();
    await scans[1]!.answer([OTHER]);

    expect(channels[0]!.closed).toBe(true);
    expect(openChannels().map((channel) => channel.url())).toEqual([
      `${OTHER}/`,
    ]);
  });

  it("reconnects to its server with the token the server handed it, as the same process, even beside another server", async () => {
    await start();
    await scans[0]!.answer([SERVER]);
    channels[0]!.onWelcome({ token: "handed-over" });

    channels[0]!.onClose!();

    await settle();
    await scans[1]!.answer([SERVER, OTHER]);

    expect(openChannels().map((channel) => channel.url())).toEqual([
      `${SERVER}/handed-over`,
    ]);
    expect(channels[1]!.hello()).toEqual(channels[0]!.hello());
  });

  it("forgets the token and scans again when its server's port has another server, which does not know it", async () => {
    await start();
    await scans[0]!.answer([SERVER]);
    channels[0]!.onWelcome({ token: "handed-over" });
    channels[0]!.onClose!();
    await settle();
    await scans[1]!.answer([SERVER]);

    channels[1]!.onUnknownPairing();

    await settle();
    await scans[2]!.answer([SERVER]);

    expect(openChannels().map((channel) => channel.url())).toEqual([
      `${SERVER}/`,
    ]);
  });

  it("logs each tool the server hides in the process's terminal whenever it becomes hidden, once while it stays hidden", async () => {
    const warn = vi.mocked(console.warn);
    const jobs = "peek.node.jobs";
    await start();
    await scans[0]!.answer([SERVER]);

    channels[0]!.hide([]);
    channels[0]!.hide([jobs]);
    channels[0]!.hide([jobs]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[ayme] peek.node.jobs is hidden: another App Process offers a tool with the same name. Rename one."
    );

    channels[0]!.hide([]);
    channels[0]!.hide([jobs]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("uses the ws package's WebSocket where Node has none of its own, as before Node 22", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const { WebSocket } = await import("ws");
    try {
      await start();
      await vi.waitFor(() => expect(scans).toHaveLength(1));
      await scans[0]!.answer([SERVER]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(scans[0]!.WebSocket).toBe(WebSocket);
    expect(channels[0]!.WebSocket).toBe(WebSocket);
  });

  it("stops scanning and closes its channel once disposed", async () => {
    const connection = await start();
    await scans[0]!.answer([SERVER]);

    connection.dispose();
    channels[0]!.onClose?.();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 2);

    expect(channels[0]!.closed).toBe(true);
    expect(scans).toHaveLength(1);
  });
});
