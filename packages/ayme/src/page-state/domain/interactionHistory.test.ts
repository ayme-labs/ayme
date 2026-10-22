import { describe, expect, it } from "vitest";
import {
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { createCursors } from "./cursors";
import { InteractionHistory } from "./interactionHistory";

let now = 0;
const clock = { now: () => MonotonicTimeMsSchema.parse(++now) };

const at = (url: string, onClock = clock) =>
  new InteractionHistory({
    pageId: PageIdSchema.parse("document_1"),
    url,
    clock: onClock,
  });

function tree(yaml: string): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
}

describe("InteractionHistory actions", () => {
  const empty = () => tree('- button "Save" [ref=e1]');
  const saved = () =>
    tree('- button "Save" [ref=e1]\n- status "Saved" [ref=e2]');

  it("stands the first observation in for a cursor that received nothing", () => {
    const history = at("http://localhost:3000/");
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
    const history = at("http://localhost:3000/");
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
    const history = at("http://localhost:3000/");
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

  it("reads a page captured in the same clock tick an action starts in as that action's before", async () => {
    // A browser coarsens performance.now(): a capture that resolves a ref and
    // the action started right after it can read the same time.
    const coarse = { now: () => MonotonicTimeMsSchema.parse(7) };
    const history = at("http://localhost:3000/", coarse);
    history.observe(empty(), history.now());
    history.observe(
      tree('- button "Save" [ref=e1]\n- status "Drifted" [ref=e3]'),
      history.now()
    );
    const actionId = history.startAction({ tool: "App.save", args: {} });

    history.completeAction(
      actionId,
      tree(
        '- button "Save" [ref=e1]\n- status "Drifted" [ref=e3]\n- status "Saved" [ref=e2]'
      ),
      history.now()
    );

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
    const history = at("http://localhost:3000/");
    history.observe(empty(), history.now());
    const actionId = history.startAction({ tool: "App.save", args: {} });

    history.failAction(actionId, saved(), history.now());

    expect(history.actions().get(actionId)).toMatchObject({ failed: true });
    const { actionChange } =
      await history.observations.getActionEvidence(actionId);
    expect(actionChange.changeTree.hasAnyChanges()).toBe(true);
  });
});
