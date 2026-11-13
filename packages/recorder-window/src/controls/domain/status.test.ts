import { describe, expect, it } from "vitest";

import { statusText } from "./status";

describe("what the window says the recorder is doing", () => {
  it("says it connects until it has heard the recorder", () => {
    expect(statusText(null)).toBe("Connecting…");
  });

  it("names where a recorder that ended saved its package, or why it failed", () => {
    expect(
      statusText({
        phase: "ended",
        outcome: { kind: "saved", folder: "/project/.ayme/recordings/rec_1" },
        visits: [],
        commands: [],
      })
    ).toBe("Saved /project/.ayme/recordings/rec_1/package.yaml");
    expect(
      statusText({
        phase: "ended",
        outcome: { kind: "failed", reason: "ENOSPC" },
        visits: [],
        commands: [],
      })
    ).toBe("Failed: ENOSPC");
  });
});
