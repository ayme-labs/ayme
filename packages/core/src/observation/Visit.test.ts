import { describe, expect, it } from "vitest";

import { VisitIdSchema, VisitStartedCauseSchema } from "./Visit";

describe("VisitIdSchema", () => {
  it("accepts a visit id", () => {
    expect(VisitIdSchema.parse("visit_12")).toBe("visit_12");
  });

  it.each(["visit_", "visit_a", "xvisit_1", "visit_1x"])(
    "rejects %s",
    (value) => {
      expect(VisitIdSchema.safeParse(value).success).toBe(false);
    }
  );
});

describe("VisitStartedCauseSchema", () => {
  it.each(["initial", "navigate", "openPage"])("accepts %s", (cause) => {
    expect(VisitStartedCauseSchema.parse(cause)).toBe(cause);
  });
});
