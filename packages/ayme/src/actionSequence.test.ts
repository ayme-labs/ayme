// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureAriaSnapshot, waitForSettled } = vi.hoisted(() => ({
  captureAriaSnapshot: vi.fn(),
  waitForSettled: vi.fn(),
}));

vi.mock("@ayme-dev/playwright-lite/internal", () => ({ captureAriaSnapshot }));
vi.mock("./registry", () => ({
  getRegisteredPomStructure: async () => ({ roots: [], absentElements: [] }),
}));
vi.mock("@ayme-dev/core/structural-observation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@ayme-dev/core/structural-observation")
  >()),
  waitForSettled,
}));

import { runAction, startNavigation } from "./actionSequence";
import { createCursors } from "./cursors";
import { getInteractionHistory } from "./pageState";

const cursor = () => createCursors().of("app");

describe("runAction", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "document",
      document.implementation.createHTMLDocument("Action sequence test")
    );
    document.body.innerHTML = "<button>Save</button>";
    vi.clearAllMocks();
    waitForSettled.mockResolvedValue({ stable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes the action as failed when the post-action capture throws", async () => {
    const captureError = captureThenThrow(2);

    await expect(
      runAction(document, cursor(), { tool: "App.save", args: {} }, () => {})
    ).rejects.toBe(captureError);

    await expectOneFailedCompletedAction(3);
  });

  it("completes the action as failed, before it runs, when the before capture throws", async () => {
    const captureError = captureThenThrow(1);
    const perform = vi.fn();

    await expect(
      runAction(document, cursor(), { tool: "App.save", args: {} }, perform)
    ).rejects.toBe(captureError);

    expect(perform).not.toHaveBeenCalled();
    // The failure's own capture is the third; it fails too and the page as
    // last recorded stands in.
    await expectOneFailedCompletedAction(3);
  });

  it("completes the action as failed when perform and the capture after it throw", async () => {
    captureThenThrow(2);
    const performError = new Error("Save failed.");

    await expect(
      runAction(document, cursor(), { tool: "App.save", args: {} }, () => {
        throw performError;
      })
    ).rejects.toBe(performError);

    await expectOneFailedCompletedAction(3);
  });
});

/**
 * The first `successes` captures succeed with one unchanged page (the one
 * that starts the action, then the before capture); the next one throws.
 */
function captureThenThrow(successes: number): Error {
  const tree = '- generic [ref=e1]:\n  - button "Save" [ref=e2]';
  for (let i = 0; i < successes; i++)
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: tree,
      fullText: tree,
      refsByElement: new Map([[document.body, "e1"]]),
    });
  const captureError = new Error("Capture failed.");
  captureAriaSnapshot.mockImplementationOnce(() => {
    throw captureError;
  });
  return captureError;
}

async function expectOneFailedCompletedAction(captures: number) {
  const history = getInteractionHistory(document);
  const [[actionId, action]] = [...history.actions()];
  expect(action).toMatchObject({ failed: true });
  // Recorded against the last observation: no capture after the failed one.
  expect(captureAriaSnapshot).toHaveBeenCalledTimes(captures);
  // Core has evidence only for a completed action; a started one throws.
  await expect(
    history.observations.getActionEvidence(actionId!)
  ).resolves.toBeDefined();
}

describe("startNavigation without the Navigation API", () => {
  it("waits for the browser Page's call to end", async () => {
    // jsdom's window has no `navigation`, as in a browser without the API.
    let end!: () => void;
    const started = vi.fn();
    void startNavigation(
      document,
      () => new Promise<void>((resolve) => (end = resolve))
    ).then(started);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).not.toHaveBeenCalled();

    end();
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  });
});
