import { describe, expect, it, vi } from "vitest";

import type {
  InspectorContract,
  InspectorEvent,
  InspectorObserver,
} from "../shared";
import { inspectorChannelPort } from "./inspectorChannelPort";

/** A contract whose commands only record how they were called. */
function recordingContract() {
  const calls: [string, unknown][] = [];
  const observers = new Set<InspectorObserver>();
  const record =
    (name: string, result: unknown = { state: { revision: 1 } }) =>
    (request?: unknown) => {
      calls.push([name, request]);
      return Promise.resolve(result);
    };
  const contract: InspectorContract = {
    getState: record("getState"),
    subscribe(observer: InspectorObserver) {
      observers.add(observer);
      return () => void observers.delete(observer);
    },
    runTool: record("runTool"),
    highlight: record("highlight"),
    pick: record("pick"),
    cancelPick: record("cancelPick"),
    look: record("look"),
    recordedPageState: record("recordedPageState", undefined),
    demo: record("demo"),
    pomDefinitionText: record("pomDefinitionText", "text"),
  } as never;
  return {
    contract,
    calls,
    emit: (event: InspectorEvent) =>
      observers.forEach((observer) => observer.onEvent(event)),
    observers,
  };
}

describe("inspectorChannelPort", () => {
  it.each([
    ["getState", undefined],
    ["runTool", { name: "click", input: { target: "e1" } }],
    ["highlight", { layer: "hover", refs: ["e1"] }],
    ["pick", { id: "p1", refs: ["e1"] }],
    ["cancelPick", { id: "p1" }],
    ["look", undefined],
    ["recordedPageState", undefined],
    ["demo", { on: true }],
    ["pomDefinitionText", { names: ["Cart"] }],
  ])(
    "runs the contract's %s with the params it is given",
    async (method, params) => {
      const { contract, calls } = recordingContract();

      await inspectorChannelPort(contract).request(method, params);

      expect(calls).toEqual([[method, params]]);
    }
  );

  it("answers what the contract answers", async () => {
    const { contract } = recordingContract();

    expect(
      await inspectorChannelPort(contract).request("pomDefinitionText", {})
    ).toBe("text");
  });

  it("rejects a method the contract has not", async () => {
    const { contract } = recordingContract();

    await expect(
      inspectorChannelPort(contract).request("destroy", {})
    ).rejects.toThrow('The Inspector contract has no "destroy".');
    // Not an inherited property either.
    await expect(
      inspectorChannelPort(contract).request("constructor", {})
    ).rejects.toThrow('has no "constructor"');
  });

  it("starts each request when it is made, so a cancelPick reaches the pick before it", () => {
    const { contract, calls } = recordingContract();
    const port = inspectorChannelPort(contract);

    void port.request("pick", { id: "p1", refs: [] });
    void port.request("cancelPick", { id: "p1" });

    expect(calls.map(([name]) => name)).toEqual(["pick", "cancelPick"]);
  });

  it("gives the contract's events, in plain data", () => {
    const { contract, emit } = recordingContract();
    const heard: unknown[] = [];
    inspectorChannelPort(contract).subscribe((event) => heard.push(event));
    const event = {
      type: "agent-image-run",
      revision: 2,
      run: { name: "screenshot", input: {}, startedAt: 1, durationMs: 2 },
    } as const;

    emit(event);

    expect(heard).toEqual([event]);
    expect(JSON.parse(JSON.stringify(heard[0]))).toEqual(event);
  });

  it("ends the highlights and the Inspector's Demo Mode request when its events stop", async () => {
    const { contract, calls, observers } = recordingContract();
    const stop = inspectorChannelPort(contract).subscribe(() => {});
    expect(observers.size).toBe(1);

    stop();
    await vi.waitFor(() => expect(calls).toHaveLength(3));

    expect(observers.size).toBe(0);
    expect(calls).toEqual([
      ["highlight", { layer: "hover", refs: [] }],
      ["highlight", { layer: "pinned", refs: [] }],
      ["demo", { on: false }],
    ]);
  });
});
