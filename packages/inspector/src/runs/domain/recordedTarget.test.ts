import { expect, it } from "vitest";

import { forest, node } from "../../structure/test-utils/projected";
import { recordedTargetName } from "./recordedTarget";

const recorded = {
  projected: forest(
    node(
      { ref: "e1", role: "main" },
      node({ ref: "e2", role: "button", name: "Dismiss notice" }),
      node({ ref: "e3", role: "generic" }, "Plain text"),
      node({ ref: "e4", role: "generic" })
    )
  ),
  refs: ["e1", "e2", "e3", "e4"],
};

it("names a ref by the role and name it had in the recorded page state", () => {
  expect(recordedTargetName(recorded, "e2")).toBe('button "Dismiss notice"');
});

it("names an unnamed node by its direct text", () => {
  expect(recordedTargetName(recorded, "e3")).toBe("generic Plain text");
});

it("does not invent a generic name for an unnamed target", () => {
  expect(recordedTargetName(recorded, "e4")).toBeUndefined();
});

it("names nothing the recorded page state does not hold", () => {
  expect(recordedTargetName(recorded, "e9")).toBeUndefined();
  expect(recordedTargetName(undefined, "e2")).toBeUndefined();
});
