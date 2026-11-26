import type { RecorderState } from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { statusText } from "./status";

describe("what the window says the recorder is doing", () => {
  it.each<[RecorderState["phase"]]>([
    ["notRecording"],
    ["recording"],
    ["paused"],
  ])("says nothing while %s: the controls show it", (phase) => {
    expect(
      statusText({
        phase,
        visits: [],
        commands: [],
        warnings: [],
        url: null,
      } as unknown as RecorderState)
    ).toBeNull();
  });

  it.each<[RecorderState["phase"], Record<string, unknown>, string]>([
    ["wrappingUp", { then: "pause" }, "Wrapping up, then pausing"],
    ["wrappingUp", { then: "clear" }, "Wrapping up, then clearing"],
    ["wrappingUp", { then: "save" }, "Wrapping up, then saving"],
    ["saving", {}, "Saving the recording"],
    ["ended", { outcome: { kind: "empty" } }, "Ended: nothing was recorded"],
  ])("says %s %o as %s", (phase, more, text) => {
    expect(
      statusText({
        phase,
        ...more,
        visits: [],
        commands: [],
        warnings: [],
        url: null,
      } as unknown as RecorderState)
    ).toBe(text);
  });

  it("says it connects until it has heard the recorder", () => {
    expect(statusText(null)).toBe("Connecting…");
  });

  it("names where a recorder that ended saved its package, or why it failed", () => {
    expect(
      statusText({
        phase: "ended",
        outcome: { kind: "saved", folder: "/project/ayme/recordings/rec_1" },
        visits: [],
        commands: [],
        warnings: [],
        url: null,
      })
    ).toBe("Saved /project/ayme/recordings/rec_1/package.yaml");
    expect(
      statusText({
        phase: "ended",
        outcome: { kind: "failed", reason: "ENOSPC" },
        visits: [],
        commands: [],
        warnings: [],
        url: null,
      })
    ).toBe("Failed: ENOSPC");
  });
});
