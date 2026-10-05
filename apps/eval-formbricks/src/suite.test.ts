import { describe, expect, it } from "vitest";

import { armIds } from "./arms.ts";
import { parseSuiteOptions } from "./suite.ts";

describe("the suite options", () => {
  it("default to every defined arm, three runs each, Sonnet and 600 seconds", () => {
    const options = parseSuiteOptions([]);
    expect(options.arms).toEqual(armIds);
    expect(options.runsPerArm).toBe(3);
    expect(options.model).toBe("sonnet");
    expect(options.timeoutSeconds).toBe(600);
    expect(options.mission.id).toBe("rename-survey-and-question");
  });

  it("take the arms, run count and model from the flags", () => {
    const options = parseSuiteOptions([
      "--",
      "--arms",
      "playwright-mcp,playwright-mcp",
      "--runs",
      "5",
      "--model",
      "opus",
    ]);
    expect(options.arms).toEqual(["playwright-mcp"]);
    expect(options.runsPerArm).toBe(5);
    expect(options.model).toBe("opus");
  });

  it.each([
    ["an unknown arm", ["--arms", "nope"]],
    ["an inherited property as an arm", ["--arms", "toString"]],
    ["a run count of zero", ["--runs", "0"]],
    ["a fractional run count", ["--runs", "1.5"]],
    ["an unknown mission", ["--mission", "nope"]],
    ["a flag without a value", ["--runs"]],
  ])("reject %s", (_, argv) => {
    expect(() => parseSuiteOptions(argv)).toThrow("Usage: pnpm eval:suite");
  });
});
