import { describe, expect, it, vi } from "vitest";
import {
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type StructuralActionId,
} from "@ayme-dev/core/structural-observation";
import { createCursors } from "./cursors";
import { InteractionHistory } from "./interactionHistory";
import { PageStateSession } from "./pageStateSession";
import { runSessionAction, type ActionPage } from "./sessionAction";
import type { PageCapture } from "./structuralPageState";

let now = 0;
const clock = { now: () => MonotonicTimeMsSchema.parse(++now) };
const cursor = () => createCursors().of("app");

/** A page that settles at once and never starts a full load. */
const settledPage: ActionPage = {
  settle: async () => ({ stable: true }),
  watchFullLoad: () => ({ started: new Promise(() => {}), stop: () => {} }),
};

const capture = (yaml: string): PageCapture => ({
  tree: StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  ),
  elementsByRef: new Map(),
  pomLabels: new Map(),
});

const savePage = capture('- generic [ref=e1]:\n  - button "Save" [ref=e2]');

/**
 * A session whose captures are `captures`, in order, the last one repeated;
 * an error is a capture that throws it. `count()` is how many it took.
 */
function sessionOver(...captures: (PageCapture | Error)[]) {
  let taken = 0;
  const session = new PageStateSession(
    new InteractionHistory({
      pageId: PageIdSchema.parse("document_1"),
      url: "https://app.test/",
      clock,
    }),
    async () => {
      const next = captures[Math.min(taken++, captures.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    }
  );
  return { session, count: () => taken };
}

describe("runSessionAction", () => {
  it("answers with what the action changed", async () => {
    const { session } = sessionOver(
      savePage,
      savePage,
      capture(
        '- generic [ref=e1]:\n  - button "Save" [ref=e2]\n  - status [ref=e3]: Saved'
      )
    );

    await expect(
      runSessionAction(
        session,
        settledPage,
        cursor(),
        { tool: "App.save", args: {} },
        () => "done"
      )
    ).resolves.toMatchObject({
      result: "done",
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Saved"),
    });
  });

  it("completes the action as failed when the post-action capture throws", async () => {
    const captureError = new Error("Capture failed.");
    const { session, count } = sessionOver(savePage, savePage, captureError);

    await expect(
      runSessionAction(
        session,
        settledPage,
        cursor(),
        { tool: "App.save", args: {} },
        () => {}
      )
    ).rejects.toBe(captureError);

    await expectOneFailedCompletedAction(session);
    // Recorded against the last observation: no capture after the failed one.
    expect(count()).toBe(3);
  });

  it("completes the action as failed, before it runs, when the before capture throws", async () => {
    const captureError = new Error("Capture failed.");
    const { session, count } = sessionOver(savePage, captureError);
    const perform = vi.fn();

    await expect(
      runSessionAction(
        session,
        settledPage,
        cursor(),
        { tool: "App.save", args: {} },
        perform
      )
    ).rejects.toBe(captureError);

    expect(perform).not.toHaveBeenCalled();
    // The failure's own capture is the third; it fails too and the page as
    // last recorded stands in.
    await expectOneFailedCompletedAction(session);
    expect(count()).toBe(3);
  });

  it("completes the action as failed when perform and the capture after it throw", async () => {
    const { session, count } = sessionOver(
      savePage,
      savePage,
      new Error("Capture failed.")
    );
    const performError = new Error("Save failed.");

    await expect(
      runSessionAction(
        session,
        settledPage,
        cursor(),
        { tool: "App.save", args: {} },
        () => {
          throw performError;
        }
      )
    ).rejects.toBe(performError);

    await expectOneFailedCompletedAction(session);
    expect(count()).toBe(3);
  });
});

async function expectOneFailedCompletedAction(session: PageStateSession) {
  const [[actionId, action]] = [...session.history.actions()] as [
    [StructuralActionId, unknown],
  ];
  expect(action).toMatchObject({ failed: true });
  // Core has evidence only for a completed action; a started one throws.
  await expect(
    session.history.observations.getActionEvidence(actionId)
  ).resolves.toBeDefined();
}
