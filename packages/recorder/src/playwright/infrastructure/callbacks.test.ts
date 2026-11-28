import { describe, expect, it } from "vitest";

import type { RecorderWarning } from "../../contract";
import { reportLost, reportedSafely } from "./callbacks";

describe("a report Playwright's recorder hands the adapter", () => {
  it("reaches the adapter as it came", () => {
    const heard: unknown[] = [];
    const callback = reportedSafely(
      () => {},
      (page: string, action: { name: string }) => heard.push([page, action])
    );

    callback("page_1", { name: "click" });

    expect(heard).toEqual([["page_1", { name: "click" }]]);
  });

  it("is left out with a warning when the adapter breaks on it, and nothing is thrown at Playwright, which would end the process", () => {
    const warnings: RecorderWarning[] = [];
    const callback = reportedSafely<string, { name: string }>(
      (warning) => warnings.push(warning),
      () => {
        throw new TypeError(
          "Cannot destructure property 'held' of 'object null' as it is null."
        );
      }
    );

    expect(() => callback("page_1", { name: "click" })).not.toThrow();
    expect(warnings).toEqual([
      {
        kind: "notRecorded",
        message:
          "A step is missing from the recording: the recorder could not read Playwright's report of a click. The trace still holds it. The recorder's error: Cannot destructure property 'held' of 'object null' as it is null.",
      },
    ]);
  });

  it("is named a step in the warning when it has no name of its own", () => {
    expect(reportLost(undefined, "broke").message).toBe(
      "A step is missing from the recording: the recorder could not read Playwright's report of a step. The trace still holds it. The recorder's error: broke"
    );
  });
});
