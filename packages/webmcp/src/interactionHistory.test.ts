// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  MonotonicTimeMsSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { InteractionHistory } from "./interactionHistory";

let now = 0;
const clock = { now: () => MonotonicTimeMsSchema.parse(++now) };

function tree(yaml: string): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
}

describe("InteractionHistory without the Navigation API", () => {
  it("records a Visit per pushState, replaceState and popstate route change", () => {
    expect("navigation" in window).toBe(false);
    const history = new InteractionHistory(document, clock);
    const urls = () =>
      history.observations.getVisits().map((visit) => visit.urls);

    window.history.pushState(null, "", "/orders");
    window.history.replaceState(null, "", "/customers");
    window.history.pushState(null, "", "/customers#top");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(urls()).toEqual([
      ["http://localhost:3000/"],
      ["http://localhost:3000/orders"],
      [
        "http://localhost:3000/customers",
        "http://localhost:3000/customers#top",
      ],
    ]);
  });

  it("records a direct fragment navigation in the current Visit", async () => {
    const history = new InteractionHistory(document, clock);
    const lastUrl = () => history.observations.getVisits().at(-1)!.urls.at(-1);

    // Assigning location.hash, as a fragment link does.
    const hashChanged = new Promise((resolve) =>
      window.addEventListener("hashchange", resolve, { once: true })
    );
    window.location.hash = "details";
    await hashChanged;
    expect(lastUrl()).toBe("http://localhost:3000/customers#details");

    // A fragment navigation that fires only hashchange: the URL changes
    // through the unwrapped History method, then the event arrives.
    History.prototype.replaceState.call(window.history, null, "", "#reviews");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(lastUrl()).toBe("http://localhost:3000/customers#reviews");
    expect(history.observations.getVisits()).toHaveLength(1);
  });
});

describe("InteractionHistory cursors", () => {
  const empty = () => tree('- button "Save" [ref=e1]');
  const saved = () =>
    tree('- button "Save" [ref=e1]\n- status "Saved" [ref=e2]');

  it("stands the first observation in for a caller that received nothing", () => {
    const history = new InteractionHistory(document, clock);
    const first = history.observe(empty(), history.now());
    history.observe(saved(), history.now());

    expect(history.cursor("agent")).toBe(first);
    expect(history.cursor("goalLoop")).toBe(first);
  });

  it("renders an action against the acting caller's cursor and moves only that cursor", async () => {
    const history = new InteractionHistory(document, clock);
    const agentRead = history.observe(empty(), history.now(), "agent");
    history.observe(empty(), history.now(), "goalLoop");
    const actionId = history.startAction("goalLoop", {
      tool: "App.save",
      args: {},
    });

    const changes = await history.completeAction(
      actionId,
      saved(),
      history.now()
    );

    expect(changes.getNodesByStatus("added").map((node) => node.name)).toEqual([
      "Saved",
    ]);
    expect(history.actions().get(actionId)?.caller).toBe("goalLoop");
    expect(history.cursor("agent")).toBe(agentRead);

    history.handOver();
    expect(history.cursor("agent")?.capturedForActionId).toBe(actionId);
  });

  it("completes an action whose tool call failed without moving a cursor", async () => {
    const history = new InteractionHistory(document, clock);
    const agentRead = history.observe(empty(), history.now(), "agent");
    const actionId = history.startAction("agent", {
      tool: "App.save",
      args: {},
    });

    history.failAction(actionId, saved(), history.now());

    expect(history.actions().get(actionId)).toMatchObject({ failed: true });
    expect(history.cursor("agent")).toBe(agentRead);
    const { actionChange } =
      await history.observations.getActionEvidence(actionId);
    expect(actionChange.changeTree.hasAnyChanges()).toBe(true);
  });
});
