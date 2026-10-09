import { expect, it } from "vitest";

import {
  getInspectorTrace,
  recordInspectorTrace,
  resetInspectorTrace,
} from "./trace";

// Unit tests: the Inspector's own trace of the calls a run makes.

it("starts with nothing recorded", () => {
  expect(getInspectorTrace()).toEqual([]);
});

it("lists the recorded calls in order until it is reset", () => {
  recordInspectorTrace({ operation: "click", locator: "getByRole('button')" });
  recordInspectorTrace({ operation: "keyboard.press", value: "Enter" });

  expect(getInspectorTrace().map(({ operation }) => operation)).toEqual([
    "click",
    "keyboard.press",
  ]);

  resetInspectorTrace();
  expect(getInspectorTrace()).toEqual([]);
});
