import { afterEach, describe, expect, it, vi } from "vitest";

import type { InspectorState } from "@ayme-dev/ayme/inspector";

import {
  emptyInspectorState,
  inspectorClient,
  inspectorShadowRoot,
} from "./shared/infrastructure";

// Unit tests: the Inspector's external build in the page a Session serves,
// against a WebSocket the test drives as the Session's process. The window
// and the Agent App's chat it runs in end to end are tested in
// `apps/mcp-fixture`.

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readonly sent: { id: number; method: string }[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  /** The server accepts the connection and tells the Tab `tab`. */
  openOnTab(tab = 1) {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
    this.receive({ tab });
  }
  /** The server says something. */
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** The connection closes, or never opened. */
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

// The Agent App's side of the frame: it shows the page inline, and offers
// fullscreen.
vi.mock("@modelcontextprotocol/ext-apps/app-with-deps", () => ({
  App: class {
    connect = async () => {};
    getHostContext = () => ({
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    });
    sendSizeChanged = async () => {};
  },
}));

const socket = () => FakeWebSocket.instances.at(-1)!;
const hosts = () => document.querySelectorAll("[data-ayme-inspector-host]");
const notice = () => document.querySelector('[role="status"]')?.textContent;
const fullscreenButton = () =>
  inspectorShadowRoot(hosts()[0]!)?.querySelector(
    'button[aria-label="Fullscreen"]'
  );

vi.stubGlobal("WebSocket", FakeWebSocket);
// The served page loads the build to start it: this one starts in a window,
// and ends as its Session does, before the tests start their own.
const { startExternalInspector } = await import("./external");
const loaded = socket();
const hostAtLoad = hosts().length;
loaded.receive({ ended: "The Session ended." });

let started: { dispose(): void } | undefined;
afterEach(() => {
  started?.dispose();
  started = undefined;
  vi.useRealTimers();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

/** The page an Agent App shows, which names the Session's socket. */
function inAgentApp(socketUrl: string) {
  const config = document.createElement("script");
  config.type = "application/json";
  config.id = "ayme-inspector-app";
  config.textContent = JSON.stringify({ socket: socketUrl });
  document.body.append(config);
}

/** The page of the Session named `name`. */
function servedBy(name: string) {
  const meta = document.createElement("meta");
  meta.name = "ayme-session";
  meta.content = name;
  document.head.append(meta);
}

describe("the Inspector in a page a Session serves", () => {
  it("starts when the page loads", () => {
    expect(loaded).toBeDefined();
    expect(hostAtLoad).toBe(1);
  });

  it("in a window, reads the Session on the socket of the host that served it", () => {
    started = startExternalInspector();

    expect(socket().url).toBe(`ws://${location.host}/inspector/ws`);
  });

  it("removes itself when disposed", () => {
    started = startExternalInspector();

    started.dispose();

    expect(hosts()).toHaveLength(0);
  });

  it("in a window served over https, connects over wss", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "shop.test:9351" });
    try {
      started = startExternalInspector();
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal("WebSocket", FakeWebSocket);
    }

    expect(socket().url).toBe("wss://shop.test:9351/inspector/ws");
  });

  it("in an Agent App's chat, reads the Session on the socket the page names", () => {
    inAgentApp("ws://127.0.0.1:9351/inspector/ws?token=t");
    started = startExternalInspector();

    expect(socket().url).toBe("ws://127.0.0.1:9351/inspector/ws?token=t");
    expect(hosts()).toHaveLength(1);
  });

  it("in an Agent App's chat, offers the fullscreen the Agent App offers, also once it mounts again for a new Tab or for none", async () => {
    inAgentApp("ws://127.0.0.1:9351/inspector/ws?token=t");
    started = startExternalInspector();
    await vi.waitFor(() => expect(fullscreenButton()).toBeTruthy());
    socket().openOnTab(1);

    socket().receive({ tab: 2 });
    await vi.waitFor(() => expect(fullscreenButton()).toBeTruthy());

    socket().receive({ tab: 2, noTab: true });
    await vi.waitFor(() => expect(fullscreenButton()).toBeTruthy());
  });

  it("in a window, offers no fullscreen", async () => {
    started = startExternalInspector();
    await vi.waitFor(() =>
      expect(
        inspectorShadowRoot(hosts()[0]!)?.querySelector("header")
      ).toBeTruthy()
    );

    expect(fullscreenButton()).toBeFalsy();
  });

  it("reads the Session through a client of its own, which hears none of the page's DOM events", () => {
    started = startExternalInspector();

    expect(inspectorClient().external).toBe(true);
  });

  it("mounts again for a new Tab, as for a reload", () => {
    started = startExternalInspector();
    socket().openOnTab(1);
    const before = hosts()[0];

    socket().receive({ tab: 2 });

    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]).not.toBe(before);
  });

  it("forgets what it read of the Tab before once the Session shows no Tab, and mounts again", async () => {
    started = startExternalInspector();
    const before = hosts()[0];
    inspectorClient().subscribe(() => {});
    socket().openOnTab(1);
    for (const { id, method } of socket().sent)
      if (method === "getState")
        socket().receive({ id, result: { ...state, revision: 1 } });
    await vi.waitFor(() =>
      expect(inspectorClient().current().tools).toHaveLength(1)
    );

    socket().receive({ tab: 1, noTab: true });

    expect(inspectorClient().current()).toBe(emptyInspectorState);
    expect(inspectorClient().external).toBe(true);
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]).not.toBe(before);
  });

  it.each([
    {
      where: "in a window",
      agentApp: false,
      inChat: "Ask your agent to show it again.",
      says: "The Session ended.",
    },
    {
      where: "in an Agent App's chat",
      agentApp: true,
      inChat: "Ask your agent to show it again.",
      says: "Ask your agent to show it again.",
    },
    {
      where: "in an Agent App's chat the Session says nothing for",
      agentApp: true,
      inChat: undefined,
      says: "The Session ended.",
    },
  ])(
    "once the Session ends, says so in its place $where",
    ({ agentApp, inChat, says }) => {
      if (agentApp) inAgentApp("ws://127.0.0.1:9351/inspector/ws?token=t");
      started = startExternalInspector();

      socket().receive({ ended: "The Session ended.", inChat });

      expect(hosts()).toHaveLength(0);
      expect(notice()).toBe(says);
    }
  );

  it.each([
    {
      where: "in a window",
      agentApp: false,
      says: "This Inspector lost the Session shop. Start it again with ayme -s=shop open, then run ayme -s=shop inspect.",
    },
    {
      where: "in an Agent App's chat",
      agentApp: true,
      says: "This Inspector lost the Session shop. Start it again with ayme -s=shop open, then ask your agent to show the Inspector again.",
    },
  ])(
    "once three tries in a row find no Session, says which it lost and how to get it back, $where",
    async ({ agentApp, says }) => {
      vi.useFakeTimers();
      servedBy("shop");
      if (agentApp) inAgentApp("ws://127.0.0.1:9351/inspector/ws?token=t");
      started = startExternalInspector();
      socket().close();
      for (let tries = 0; tries < 3; tries++) {
        expect(notice()).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1000);
        socket().close();
      }

      expect(hosts()).toHaveLength(0);
      expect(notice()).toBe(says);
    }
  );
});

const state: InspectorState = {
  ...emptyInspectorState,
  revision: 1,
  tools: [
    {
      name: "click",
      inputSchema: { type: "object" },
      group: "browser",
      available: true,
    },
  ],
};
