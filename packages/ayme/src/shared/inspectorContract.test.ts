import { describe, expect, it } from "vitest";

import { mergeInspectorState, type InspectorState } from "./inspectorContract";

const state = (revision: number): InspectorState => ({
  revision,
  tools: [],
  appProcessTools: [],
  publication: { state: "disabled", message: "off" },
  agentConnection: { state: "off" },
  runs: [],
});

describe("mergeInspectorState", () => {
  it("takes the first state it sees", () => {
    expect(mergeInspectorState(undefined, state(3))).toEqual(state(3));
  });

  it("takes a newer state", () => {
    expect(mergeInspectorState(state(3), state(4)).revision).toBe(4);
  });

  it("keeps the newest state when an older one arrives", () => {
    const current = state(5);
    expect(mergeInspectorState(current, state(4))).toBe(current);
  });

  it("keeps the state it holds when the same revision arrives again", () => {
    const current = state(5);
    expect(mergeInspectorState(current, state(5))).toBe(current);
  });
});
