import { expect, it } from "vitest";

import type {
  InspectorContract,
  InspectorEvent,
  InspectorObserver,
  InspectorState,
} from "@ayme-dev/ayme/inspector";

import { createInspectorClient } from "./inspectorClient";

// Unit tests: the Inspector's contract client over a transport the test
// drives, the way the inline transport hands it the runtime's contract.

const state = (revision: number, tool = "click"): InspectorState => ({
  revision,
  tools: [
    {
      name: tool,
      inputSchema: { type: "object" },
      group: "browser",
      available: true,
    },
  ],
  appProcessTools: [],
  publication: { state: "active", message: "" },
  agentConnection: { state: "off" },
  runs: [],
  pageObjects: [],
  pomDefinitions: [],
});

function transport(initial: InspectorState) {
  const observers = new Set<InspectorObserver>();
  const calls: unknown[] = [];
  const contract: InspectorContract = {
    getState: async () => initial,
    subscribe(observer) {
      observers.add(observer);
      return () => void observers.delete(observer);
    },
    runTool: async (request) => (calls.push(request), { state: initial }),
    highlight: async (request) => (calls.push(request), { state: initial }),
    pick: async (request) => ({ state: initial, ref: request.refs[0] }),
    cancelPick: async (request) => (calls.push(request), { state: initial }),
    look: async () => {
      throw new Error("No look in this test.");
    },
    pomDefinitionText: async () => "",
    recordedPageState: async () => ({
      projected: { roots: [] },
      refs: ["e1"],
    }),
    demo: async (request) => (calls.push(request), { state: initial }),
  };
  return {
    contract,
    calls,
    push: (event: InspectorEvent) => observers.forEach((o) => o.onEvent(event)),
    listening: () => observers.size,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

it("holds the state the transport answers once someone listens", async () => {
  const t = transport(state(3));
  const client = createInspectorClient(t.contract);
  expect(client.current().revision).toBe(0);
  const stop = client.subscribe(() => {});
  await settled();
  expect(client.current().revision).toBe(3);
  stop();
});

it("takes a state event with a higher revision", async () => {
  const t = transport(state(3));
  const client = createInspectorClient(t.contract);
  client.subscribe(() => {});
  await settled();
  t.push({ type: "state", state: state(4, "hover") });
  expect(client.current().tools[0]?.name).toBe("hover");
});

it("never lets an event with a lower revision overwrite the newer state", async () => {
  const t = transport(state(5));
  const client = createInspectorClient(t.contract);
  const heard: number[] = [];
  client.subscribe(() => heard.push(client.current().revision));
  await settled();
  t.push({ type: "state", state: state(4, "stale") });
  expect(client.current().revision).toBe(5);
  expect(client.current().tools[0]?.name).toBe("click");
  expect(heard).toEqual([5]);
});

it("keeps the newest state when a command's answer is older than an event", async () => {
  const t = transport(state(5));
  const client = createInspectorClient(t.contract);
  client.subscribe(() => {});
  await settled();
  t.push({ type: "state", state: state(7, "newest") });
  await client.runTool({ name: "click" });
  expect(client.current().revision).toBe(7);
});

it("stops listening to the transport when the last listener leaves", async () => {
  const t = transport(state(1));
  const client = createInspectorClient(t.contract);
  const stopA = client.subscribe(() => {});
  const stopB = client.subscribe(() => {});
  expect(t.listening()).toBe(1);
  stopA();
  expect(t.listening()).toBe(1);
  stopB();
  expect(t.listening()).toBe(0);
});

it("passes agent image runs to those who listen for them", async () => {
  const t = transport(state(1));
  const client = createInspectorClient(t.contract);
  const heard: string[] = [];
  client.subscribe(() => {});
  client.onAgentImageRun((run) => heard.push(run.name));
  t.push({
    type: "agent-image-run",
    revision: 1,
    run: { name: "screenshot", input: {}, startedAt: 1, durationMs: 2 },
  });
  expect(heard).toEqual(["screenshot"]);
});

it("picks a ref and cancels the pick when its signal aborts", async () => {
  const t = transport(state(1));
  const client = createInspectorClient(t.contract);
  expect(await client.pick(["e2"], new AbortController().signal)).toBe("e2");
  const controller = new AbortController();
  void client.pick(["e2"], controller.signal);
  controller.abort();
  await settled();
  expect(t.calls).toEqual([
    expect.objectContaining({ id: expect.any(String) }),
  ]);
});

it("numbers picks apart from every other client's, so windows on one server never share a pick id", async () => {
  const ids: string[] = [];
  const open = () => {
    const contract: InspectorContract = {
      ...transport(state(1)).contract,
      pick: async (request) => (
        ids.push(request.id),
        { state: state(1), ref: request.refs[0] }
      ),
    };
    return createInspectorClient(contract);
  };
  const [first, second] = [open(), open()];
  const signal = new AbortController().signal;

  await first.pick(["e1"], signal);
  await first.pick(["e1"], signal);
  await second.pick(["e1"], signal);

  expect(new Set(ids).size).toBe(3);
});

it("reads the recorded page state and asks for Demo Mode through the transport", async () => {
  const t = transport(state(2));
  const client = createInspectorClient(t.contract);
  expect(await client.recordedPageState()).toEqual({
    projected: { roots: [] },
    refs: ["e1"],
  });
  await client.demo(true);
  expect(t.calls).toEqual([{ on: true }]);
  expect(client.current().revision).toBe(2);
});
