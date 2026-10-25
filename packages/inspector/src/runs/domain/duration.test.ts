import { expect, it } from "vitest";

import { formatDuration } from "./duration";

// Unit tests: a run's duration as Runs and the run card show it.

it("shows a run under a second in milliseconds", () => {
  expect(formatDuration(0)).toBe("0 ms");
  expect(formatDuration(999)).toBe("999 ms");
});

it("shows a run of a second or more in seconds, to one decimal", () => {
  expect(formatDuration(1000)).toBe("1.0 s");
  expect(formatDuration(1004)).toBe("1.0 s");
  expect(formatDuration(15204)).toBe("15.2 s");
});
