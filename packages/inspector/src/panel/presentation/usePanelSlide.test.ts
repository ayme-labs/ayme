import { describe, expect, it } from "vitest";

import { milliseconds } from "./usePanelSlide";

describe("milliseconds", () => {
  it.each([
    ["200ms", 200],
    [".2s", 200],
    [" 200ms ", 200],
  ])("reads %j as %i", (time, expected) => {
    expect(milliseconds(time)).toBe(expected);
  });
});
