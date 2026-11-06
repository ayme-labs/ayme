import { describe, expect, it } from "vitest";

import type {
  AgentConnectionStatus,
  AppProcessTool,
  InspectorEvent,
  InspectorRun,
  ToolInfo,
} from "../shared";
import {
  createInspectorContract,
  type InspectorContractPorts,
  type InspectorSession,
} from "./inspectorContract";

const clickTool: ToolInfo = {
  name: "click",
  authorDescription: "Clicks.",
  agentDescription: "Clicks an element.",
  inputSchema: { type: "object", properties: { target: { type: "string" } } },
  group: "browser",
  available: true,
};
const unavailable: ToolInfo = {
  name: "Cart.checkout",
  inputSchema: { type: "object" },
  group: "pageObject",
  className: "Cart",
  available: false,
  reason: "Blocked by e12",
};
const run: InspectorRun = {
  id: "1",
  tool: "click",
  input: { target: "e3" },
  status: "succeeded",
  result: { ok: true },
  startedAt: 10,
  durationMs: 5,
  interactions: [{ operation: "click", locator: "button", ref: "e3" }],
  by: "app",
};

/** A session and the ports around it, each change announced as the real ones do. */
function setup() {
  const listeners = new Set<() => void>();
  const announce = () => listeners.forEach((listener) => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const current = {
    tools: [clickTool, unavailable] as readonly ToolInfo[],
    runs: [] as readonly InspectorRun[],
    processTools: [] as readonly AppProcessTool[],
    connection: { state: "off" } as AgentConnectionStatus,
  };
  const calls: unknown[][] = [];
  const session: InspectorSession = {
    tools: {
      list: () => current.tools,
      subscribe,
      run: async (name: string, input: unknown, options?: unknown) => {
        calls.push([name, input, options]);
        if (name === "boom") throw new Error("It broke.");
        current.runs = [...current.runs, run];
        announce();
        return {};
      },
    } as unknown as InspectorSession["tools"],
    runs: {
      list: () => current.runs,
      subscribe,
    } as unknown as InspectorSession["runs"],
    webMCP: {
      publicationStatus: { state: "disabled", message: "off" },
      subscribe,
    } as unknown as InspectorSession["webMCP"],
  };
  const imageListeners = new Set<(run: never) => void>();
  const highlighted: unknown[] = [];
  const ports: InspectorContractPorts = {
    started: () => session,
    subscribeToStarted: subscribe,
    appProcessTools: () => ({
      list: () => current.processTools,
      subscribe,
      run: async (name, input, options) => {
        calls.push(["process", name, input, options]);
      },
    }),
    connectionStatus: () => ({ get: () => current.connection, subscribe }),
    subscribeToAgentImageRuns: (listener) => {
      imageListeners.add(listener as never);
      return () => void imageListeners.delete(listener as never);
    },
    highlights: {
      set: async (layer, refs) => void highlighted.push([layer, refs]),
    },
    pick: async (refs, signal) =>
      new Promise((resolve) => {
        if (refs.includes("e3")) resolve("e3");
        signal.addEventListener("abort", () => resolve(undefined));
      }),
  };
  return {
    contract: createInspectorContract(ports),
    current,
    announce,
    calls,
    highlighted,
    image: (value: unknown) => imageListeners.forEach((l) => l(value as never)),
  };
}

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("the Inspector contract the runtime serves", () => {
  it("answers the canonical state: tools, runs, publication and connection", async () => {
    const { contract } = setup();
    const state = await contract.getState();
    expect(state.tools.map((tool) => tool.name)).toEqual([
      "click",
      "Cart.checkout",
    ]);
    expect(state.publication.state).toBe("disabled");
    expect(state.agentConnection).toEqual({ state: "off" });
    expect(state.runs).toEqual([]);
  });

  it("keeps a revision until something changes, then raises it", async () => {
    const { contract, current, announce } = setup();
    const first = await contract.getState();
    expect((await contract.getState()).revision).toBe(first.revision);
    current.tools = [clickTool];
    announce();
    expect((await contract.getState()).revision).toBeGreaterThan(
      first.revision
    );
  });

  it("pushes a state event with a higher revision on each change", async () => {
    const { contract, current, announce } = setup();
    const events: InspectorEvent[] = [];
    const stop = contract.subscribe({
      onEvent: (event) => events.push(event),
      onError: () => {},
    });
    current.runs = [run];
    announce();
    stop();
    current.runs = [];
    announce();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({ type: "state" });
    expect(event!.type === "state" && event!.state.runs).toEqual([run]);
  });

  it("runs a tool as the Caller named and answers the state after it", async () => {
    const { contract, calls } = setup();
    const result = await contract.runTool({
      name: "click",
      input: { target: "e3" },
      by: "inspector",
    });
    expect(calls[0]).toEqual(["click", { target: "e3" }, { by: "inspector" }]);
    expect(result.state.runs).toEqual([run]);
    expect(result.error).toBeUndefined();
  });

  it("answers a failed Run's error instead of throwing", async () => {
    const { contract } = setup();
    expect((await contract.runTool({ name: "boom" })).error).toBe("It broke.");
  });

  it("highlights refs in a layer", async () => {
    const { contract, highlighted } = setup();
    await contract.highlight({ layer: "pinned", refs: ["e1", "e2"] });
    expect(highlighted).toEqual([["pinned", ["e1", "e2"]]]);
  });

  it("answers the ref a pick chose, and none once cancelled", async () => {
    const { contract } = setup();
    expect((await contract.pick({ id: "a", refs: ["e3"] })).ref).toBe("e3");
    const pending = contract.pick({ id: "b", refs: ["e9"] });
    await contract.cancelPick({ id: "b" });
    expect((await pending).ref).toBeUndefined();
  });

  it("answers every command result and pushes every event as plain JSON", async () => {
    const { contract, current, announce, image } = setup();
    current.processTools = [
      {
        name: "peek.node.x",
        description: "d",
        inputSchema: { type: "object" },
      },
    ];
    current.connection = { state: "connected", agent: "claude-code" };
    const events: InspectorEvent[] = [];
    contract.subscribe({
      onEvent: (event) => events.push(event),
      onError: () => {},
    });
    announce();
    image({
      name: "screenshot",
      input: {},
      result: { data: "x" },
      savedTo: "/a.png",
      startedAt: 1,
      durationMs: 2,
    });
    const results = [
      await contract.getState(),
      await contract.runTool({ name: "click", input: { target: "e3" } }),
      await contract.runTool({ name: "boom" }),
      await contract.highlight({ layer: "hover", refs: ["e1"] }),
      await contract.pick({ id: "p", refs: ["e3"] }),
      await contract.cancelPick({ id: "p" }),
    ];
    expect(events.map((event) => event.type)).toContain("agent-image-run");
    for (const value of [...results, ...events])
      expect(roundTrip(value)).toStrictEqual(value);
  });

  it("leaves the image result's bytes out of its event", () => {
    const { contract, image } = setup();
    const events: InspectorEvent[] = [];
    contract.subscribe({
      onEvent: (event) => events.push(event),
      onError: () => {},
    });
    image({
      name: "screenshot",
      input: {},
      result: { data: "x" },
      savedTo: undefined,
      startedAt: 1,
      durationMs: 2,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "agent-image-run",
        run: { name: "screenshot", input: {}, startedAt: 1, durationMs: 2 },
      }),
    ]);
  });

  it("answers an empty state while no session has started", async () => {
    const { contract } = setup();
    const none = createInspectorContract({
      started: () => undefined,
      subscribeToStarted: () => () => {},
      appProcessTools: () => {
        throw new Error("unused");
      },
      connectionStatus: () => {
        throw new Error("unused");
      },
      subscribeToAgentImageRuns: () => () => {},
      highlights: { set: async () => {} },
      pick: async () => undefined,
    });
    expect((await none.getState()).tools).toEqual([]);
    expect((await none.runTool({ name: "click" })).error).toMatch(
      /not started|No Ayme/
    );
    void contract;
  });
});
