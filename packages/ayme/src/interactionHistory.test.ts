// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  MonotonicTimeMsSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { createCursors } from "./cursors";
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

describe("InteractionHistory actions", () => {
  const empty = () => tree('- button "Save" [ref=e1]');
  const saved = () =>
    tree('- button "Save" [ref=e1]\n- status "Saved" [ref=e2]');

  it("stands the first observation in for a cursor that received nothing", () => {
    const history = new InteractionHistory(document, clock);
    const cursor = createCursors().of("app");
    expect(history.received(cursor)).toBeUndefined();

    const first = history.observe(empty(), history.now());
    const second = history.observe(saved(), history.now());

    expect(history.firstObservation).toBe(first);
    expect(history.received(cursor)).toBe(first);
    cursor.move(second);
    expect(history.received(cursor)).toBe(second);
  });

  it("completes an action with its after observation and reads the change from where the cursor stood", async () => {
    const history = new InteractionHistory(document, clock);
    const cursor = createCursors().of("app");
    cursor.move(history.observe(empty(), history.now()));
    const actionId = history.startAction({ tool: "App.save", args: {} });
    const before = history.received(cursor)!;

    const after = history.completeAction(actionId, saved(), history.now());
    const changes = await history.readChange(before, after);

    expect(after.capturedForActionId).toBe(actionId);
    expect(changes.getNodesByStatus("added").map((node) => node.name)).toEqual([
      "Saved",
    ]);
    expect(history.actions().get(actionId)).toEqual({
      tool: "App.save",
      args: {},
    });
    // Moving the cursor is the reader's: the history moved nothing.
    expect(history.received(cursor)).toBe(before);
  });

  it("records the page right before an action as its before, which core reads the action's change from", async () => {
    const history = new InteractionHistory(document, clock);
    history.observe(empty(), history.now());
    const actionId = history.startAction({ tool: "App.save", args: {} });
    const drifted = tree(
      '- button "Save" [ref=e1]\n- status "Drifted" [ref=e3]'
    );

    const before = history.observeBefore(actionId, drifted, history.now());
    const after = history.completeAction(
      actionId,
      tree(
        '- button "Save" [ref=e1]\n- status "Drifted" [ref=e3]\n- status "Saved" [ref=e2]'
      ),
      history.now()
    );

    expect(before).toMatchObject({
      capturedForActionId: actionId,
      relation: "before",
    });
    expect(after).toMatchObject({ capturedForActionId: actionId });
    expect(after.relation).toBeUndefined();
    const { actionChange, unassignedChanges } =
      await history.observations.getActionEvidence(actionId);
    expect(
      actionChange.changeTree.getNodesByStatus("added").map((node) => node.name)
    ).toEqual(["Saved"]);
    expect(
      unassignedChanges.map((change) =>
        change.changeTree.getNodesByStatus("added").map((node) => node.name)
      )
    ).toEqual([["Drifted"]]);
  });

  it("completes an action whose tool call failed with its page", async () => {
    const history = new InteractionHistory(document, clock);
    history.observe(empty(), history.now());
    const actionId = history.startAction({ tool: "App.save", args: {} });

    history.failAction(actionId, saved(), history.now());

    expect(history.actions().get(actionId)).toMatchObject({ failed: true });
    const { actionChange } =
      await history.observations.getActionEvidence(actionId);
    expect(actionChange.changeTree.hasAnyChanges()).toBe(true);
  });
});
