import { describe, expect, it } from "vitest";

import { publishedFolder } from "./report.ts";

describe("the published summary's folder", () => {
  it("is the date for the default mission", () => {
    expect(
      publishedFolder({
        date: "2026-10-06",
        missions: ["rename-survey-and-question"],
      })
    ).toBe("2026-10-06");
  });

  it("adds the mission for any other mission, so it never overwrites the default mission's table", () => {
    expect(
      publishedFolder({
        date: "2026-10-06",
        missions: ["sign-in-create-and-revise-survey"],
      })
    ).toBe("2026-10-06-sign-in-create-and-revise-survey");
  });
});
