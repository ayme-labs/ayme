import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InspectorState } from "@ayme-dev/ayme/inspector";

import { createInspectorClient, emptyInspectorState } from "./inspectorClient";
import { webSocketInspectorContract } from "./webSocketInspectorContract";

// Unit tests: the channel transport of the Inspector contract against a
// WebSocket the test drives, the way `ayme mcp` relays it. Frames are the
// server's: requests `{ id, method, params }`; replies `{ id, result }`,
// `{ id, error }`, `{ event }`, `{ reset: true }`, `{ tab }` and `{ ended }`.

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readonly sent: {
    id: number;
    method: string;
    params?: unknown;
    tab?: number;
  }[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("not open");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** The server accepts the connection. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  /** The server says something. */
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** The server answers the request sent with `method`. */
  answer(method: string, result: unknown) {
    const request = [...this.sent].reverse().find((r) => r.method === method);
    if (!request) throw new Error(`No ${method} was sent.`);
    this.receive({ id: request.id, result });
  }
  methods() {
    return this.sent.map(({ method }) => method);
  }
}

const state = (revision: number, tool = "click"): InspectorState => ({
  ...emptyInspectorState,
  revision,
  tools: [
    {
      name: tool,
      inputSchema: { type: "object" },
      group: "browser",
      available: true,
    },
  ],
});

function connect() {
  const contract = webSocketInspectorContract(
    "ws://127.0.0.1:9351/inspector/ws",
    {
      WebSocket: FakeWebSocket as never,
      reconnectMs: 1000,
    }
  );
  const socket = () => FakeWebSocket.instances.at(-1)!;
  return { contract, socket };
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("webSocketInspectorContract", () => {
  it("connects to the given URL and asks for the state", async () => {
    const { contract, socket } = connect();
    const asked = contract.getState();
    socket().open();

    socket().answer("getState", state(4));

    expect(socket().url).toBe("ws://127.0.0.1:9351/inspector/ws");
    expect(await asked).toEqual(state(4));
  });

  it("sends requests in the order they are made, those made before the socket opens too", () => {
    const { contract, socket } = connect();

    void contract.pick({ id: "pick-1", refs: ["e1"] });
    void contract.cancelPick({ id: "pick-1" });
    socket().open();
    void contract.highlight({ layer: "hover", refs: [] });

    expect(socket().sent).toEqual([
      {
        id: expect.any(Number),
        method: "pick",
        params: { id: "pick-1", refs: ["e1"] },
      },
      {
        id: expect.any(Number),
        method: "cancelPick",
        params: { id: "pick-1" },
      },
      {
        id: expect.any(Number),
        method: "highlight",
        params: { layer: "hover", refs: [] },
      },
    ]);
  });

  it("answers each command with the state after it, and a pick with its ref", async () => {
    const { contract, socket } = connect();
    socket().open();

    const picked = contract.pick({ id: "pick-1", refs: ["e1"] });
    socket().answer("pick", { state: state(2), ref: "e1" });

    expect(await picked).toEqual({ state: state(2), ref: "e1" });
  });

  it("rejects a request the server answers with an error", async () => {
    const { contract, socket } = connect();
    socket().open();

    const asked = contract.getState();
    const [{ id }] = socket().sent;
    socket().receive({
      id,
      error: "No page is connected to this ayme MCP server.",
    });

    await expect(asked).rejects.toThrow("No page is connected");
  });

  it("reads a recorded page state that is none as undefined", async () => {
    const { contract, socket } = connect();
    socket().open();

    const asked = contract.recordedPageState();
    socket().answer("recordedPageState", null);

    expect(await asked).toBeUndefined();
  });

  it("subscribes the server once for all observers, and gives each the events", () => {
    const { contract, socket } = connect();
    socket().open();
    const first: unknown[] = [];
    const second: unknown[] = [];

    const stopFirst = contract.subscribe({
      onEvent: (event) => first.push(event),
      onError: () => {},
    });
    const stopSecond = contract.subscribe({
      onEvent: (event) => second.push(event),
      onError: () => {},
    });
    socket().receive({ event: { type: "state", state: state(3) } });

    expect(socket().methods()).toEqual(["subscribe"]);
    expect(first).toEqual([{ type: "state", state: state(3) }]);
    expect(second).toEqual(first);
    stopFirst();
    expect(socket().methods()).toEqual(["subscribe"]);
    stopSecond();
    expect(socket().methods()).toEqual(["subscribe", "unsubscribe"]);
  });

  it("tells when the page is a new document, before it reads its state", () => {
    const calls: string[] = [];
    webSocketInspectorContract("ws://x/inspector/ws", {
      WebSocket: FakeWebSocket as never,
      onNewPage: () =>
        calls.push(`new page after ${socketOf().methods().length} requests`),
    });
    const socketOf = () => FakeWebSocket.instances.at(-1)!;
    socketOf().open();

    socketOf().receive({ reset: true });

    expect(calls).toEqual(["new page after 0 requests"]);
    expect(socketOf().methods()).toEqual(["getState"]);
  });

  describe("a new page", () => {
    /** A client of the transport that showed the page at revision 7. */
    async function clientAt7() {
      const { contract, socket } = connect();
      socket().open();
      const client = createInspectorClient(contract);
      client.subscribe(() => {});
      socket().answer("getState", state(7, "old"));
      await vi.advanceTimersByTimeAsync(0);
      expect(client.current().revision).toBe(7);
      return { client, socket };
    }

    it("shows its state although its revisions start again", async () => {
      const { client, socket } = await clientAt7();

      socket().receive({ reset: true });
      // The transport reads the new page's state.
      socket().answer("getState", state(1, "new"));
      await vi.advanceTimersByTimeAsync(0);
      socket().receive({ event: { type: "state", state: state(2, "newer") } });

      expect(client.current().tools.map(({ name }) => name)).toEqual(["newer"]);
      expect(client.current().revision).toBeGreaterThan(7);
    });

    it("still never lets an event with a lower revision replace newer state", async () => {
      const { client, socket } = await clientAt7();
      socket().receive({ reset: true });
      socket().answer("getState", state(1, "new"));
      await vi.advanceTimersByTimeAsync(0);
      socket().receive({ event: { type: "state", state: state(3, "three") } });

      socket().receive({ event: { type: "state", state: state(2, "two") } });

      expect(client.current().tools.map(({ name }) => name)).toEqual(["three"]);
    });

    it("moves the revision of an image run and a command's state the same way", async () => {
      const { client, socket } = await clientAt7();
      socket().receive({ reset: true });
      socket().answer("getState", state(1));
      await vi.advanceTimersByTimeAsync(0);

      const demo = client.demo(true);
      socket().answer("demo", { state: state(2, "after demo") });
      await demo;

      expect(client.current().tools[0]!.name).toBe("after demo");
    });
  });

  describe("when the server goes away", () => {
    it("rejects the requests still waiting", async () => {
      const { contract, socket } = connect();
      socket().open();
      const asked = contract.pick({ id: "pick-1", refs: [] });
      const rejected = expect(asked).rejects.toThrow("closed");

      socket().close();

      await rejected;
    });

    it("connects again, subscribes again and reads the state again", async () => {
      const { contract, socket } = connect();
      socket().open();
      const events: unknown[] = [];
      contract.subscribe({ onEvent: (e) => events.push(e), onError: () => {} });
      const first = socket();
      first.close();

      await vi.advanceTimersByTimeAsync(1000);
      const second = socket();
      expect(second).not.toBe(first);
      second.open();
      await vi.advanceTimersByTimeAsync(0);
      second.answer("getState", state(1));
      await vi.advanceTimersByTimeAsync(0);

      expect(second.methods()).toEqual(["subscribe", "getState"]);
      expect(events).toEqual([{ type: "state", state: state(1) }]);
    });
  });

  describe("on a Session, which tells the Tab the window shows", () => {
    /** A client of a Session's transport that shows the Tab `1` at
     * revision 7. */
    async function sessionClient() {
      const newPages: number[] = [];
      const contract = webSocketInspectorContract("ws://x/inspector/ws", {
        WebSocket: FakeWebSocket as never,
        followsTabs: true,
        onNewPage: () => newPages.push(newPages.length + 1),
      });
      const socket = () => FakeWebSocket.instances.at(-1)!;
      const client = createInspectorClient(contract);
      client.subscribe(() => {});
      socket().open();
      return { contract, client, socket, newPages };
    }

    it("sends nothing until the Session told the Tab, then names it in every request", async () => {
      const { contract, socket, newPages } = await sessionClient();
      void contract.look();

      expect(socket().sent).toEqual([]);
      socket().receive({ tab: 1 });

      expect(socket().sent).toEqual([
        { id: expect.any(Number), method: "subscribe", tab: 1 },
        { id: expect.any(Number), method: "getState", tab: 1 },
        { id: expect.any(Number), method: "look", tab: 1 },
      ]);
      expect(newPages).toEqual([]);
    });

    it("reads a new Tab as a new page, and names it from then on", async () => {
      const { contract, socket, newPages } = await sessionClient();
      socket().receive({ tab: 1 });

      socket().receive({ tab: 2 });
      void contract.look();

      expect(newPages).toEqual([1]);
      expect(socket().sent.slice(-2)).toEqual([
        { id: expect.any(Number), method: "getState", tab: 2 },
        { id: expect.any(Number), method: "look", tab: 2 },
      ]);
    });

    it("drops the answer to a request made on the Tab before, so it never reaches what the window shows of the new one", async () => {
      const { contract, client, socket } = await sessionClient();
      socket().receive({ tab: 1 });
      socket().answer("getState", state(7, "first Tab"));
      await vi.advanceTimersByTimeAsync(0);
      const run = contract.runTool({ name: "Basket.add", input: {} });
      const dropped = expect(run).rejects.toThrow(
        "The Inspector shows another Tab now."
      );
      const ran = socket().sent.at(-1)!;

      socket().receive({ tab: 2 });
      socket().answer("getState", state(1, "second Tab"));
      await vi.advanceTimersByTimeAsync(0);
      socket().receive({ id: ran.id, result: { state: state(8, "late") } });
      await vi.advanceTimersByTimeAsync(0);

      await dropped;
      expect(client.current().tools.map(({ name }) => name)).toEqual([
        "second Tab",
      ]);
    });

    it("waits for the Tab again after it connects again", async () => {
      const { socket } = await sessionClient();
      socket().receive({ tab: 1 });
      socket().close();
      await vi.advanceTimersByTimeAsync(1000);

      socket().open();

      expect(socket().sent).toEqual([]);
      socket().receive({ tab: 3 });
      expect(socket().methods()).toEqual(["subscribe", "getState"]);
    });
  });

  describe("when the Session behind the server ends", () => {
    it("says why, connects no more when the server goes, and fails every request from then on", async () => {
      const ended: string[] = [];
      const contract = webSocketInspectorContract(
        "ws://127.0.0.1:9351/inspector/ws",
        {
          WebSocket: FakeWebSocket as never,
          reconnectMs: 1000,
          onEnded: (notice) => ended.push(notice),
        }
      );
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.open();
      const waiting = contract.getState();
      const rejected = expect(waiting).rejects.toThrow("closed");

      socket.receive({ ended: "The Session shop was closed." });
      socket.close();
      await vi.advanceTimersByTimeAsync(5000);

      expect(ended).toEqual(["The Session shop was closed."]);
      await rejected;
      expect(FakeWebSocket.instances).toHaveLength(1);
      await expect(contract.getState()).rejects.toThrow("closed");
    });
  });
});
