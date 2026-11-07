import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InspectorContract } from "@ayme-dev/ayme/inspector";

import { createInspectorClient, emptyInspectorState } from "./inspectorClient";
import { isInspectorOwnMutation, usePageLook } from "./usePageLook";

// Unit tests: which page changes are the Inspector's own, and so start no
// new look at the page.

const attributeChange = (attributeName: string) =>
  ({
    type: "attributes",
    attributeName,
    target: document.createElement("button"),
  }) as unknown as MutationRecord;

it("counts a change inside its host as its own", () => {
  const host = document.createElement("div");
  host.setAttribute("data-ayme-inspector-host", "");
  expect(
    isInspectorOwnMutation({
      type: "childList",
      target: host,
    } as unknown as MutationRecord)
  ).toBe(true);
});

it("counts the page's own changes as the page's", () => {
  expect(isInspectorOwnMutation(attributeChange("class"))).toBe(false);
  expect(isInspectorOwnMutation(attributeChange(""))).toBe(false);
});

describe("an Inspector in a window of its own", () => {
  const emptyLook = {
    projected: { roots: [] },
    refs: [],
    targets: [],
    targetsByRef: {},
    elementToolTargets: {},
    controls: {},
    rootedInstances: {},
  };

  /** Mounts the hook over a transport that counts the looks. */
  function mount(external: boolean) {
    let looks = 0;
    const transport = {
      getState: async () => emptyInspectorState,
      subscribe: () => () => {},
      look: async () => (looks++, emptyLook),
    } as unknown as InspectorContract;
    const client = createInspectorClient(transport, { external });
    function Probe() {
      usePageLook({ structureVisible: false, onLook: () => {}, client });
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    act(() => root.render(createElement(Probe)));
    return {
      looks: () => looks,
      unmount: () => act(() => root.unmount()),
    };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("looks at the page on a timer, which its own document's changes do not start", async () => {
    const probe = mount(true);
    await act(() => vi.advanceTimersByTimeAsync(300));
    const first = probe.looks();
    expect(first).toBe(1);

    document.body.append(document.createElement("button"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(probe.looks()).toBe(first);
    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(probe.looks()).toBeGreaterThan(first);
    probe.unmount();
  });

  it("looks again at once when its own document changes, if the Inspector is in the page", async () => {
    const probe = mount(false);
    await act(() => vi.advanceTimersByTimeAsync(300));
    const first = probe.looks();

    document.body.append(document.createElement("button"));
    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(probe.looks()).toBeGreaterThan(first);
    probe.unmount();
  });
});
