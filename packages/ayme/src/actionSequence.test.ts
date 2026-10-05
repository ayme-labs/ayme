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
import { getInteractionHistory } from "./pageState";

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
    const captureError = captureOnceThenThrow();

    await expect(
      runAction(document, "agent", { tool: "App.save", args: {} }, () => {})
    ).rejects.toBe(captureError);

    await expectOneFailedCompletedAction();
  });

  it("completes the action as failed when perform and the capture after it throw", async () => {
    captureOnceThenThrow();
    const performError = new Error("Save failed.");

    await expect(
      runAction(document, "agent", { tool: "App.save", args: {} }, () => {
        throw performError;
      })
    ).rejects.toBe(performError);

    await expectOneFailedCompletedAction();
  });
});

/** The capture that starts the action succeeds; the one after it throws. */
function captureOnceThenThrow(): Error {
  const tree = '- generic [ref=e1]:\n  - button "Save" [ref=e2]';
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

async function expectOneFailedCompletedAction() {
  const history = getInteractionHistory(document);
  const [[actionId, action]] = [...history.actions()];
  expect(action).toMatchObject({ failed: true });
  // Recorded against the last observation: no capture after the failed one.
  expect(captureAriaSnapshot).toHaveBeenCalledTimes(2);
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
