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

import { runAction } from "./actionSequence";
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

    await expect(
      runAction(document, "agent", { tool: "App.save", args: {} }, () => {})
    ).rejects.toBe(captureError);

    const history = getInteractionHistory(document);
    const [[actionId, action]] = [...history.actions()];
    expect(action).toMatchObject({ failed: true });
    // Recorded against the last observation: no fresh capture was taken.
    expect(captureAriaSnapshot).toHaveBeenCalledTimes(2);
    const { actionChange } = await history.observations.getActionEvidence(
      actionId!
    );
    expect(actionChange.changeTree.hasAnyChanges()).toBe(false);
  });
});
