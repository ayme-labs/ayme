import { describe, expect, it } from "vitest";

import { isJsonPrimitive } from "./JsonSchema";

describe("isJsonPrimitive", () => {
  it("accepts null, strings, finite numbers, and booleans", () => {
    expect(isJsonPrimitive(null)).toBe(true);
    expect(isJsonPrimitive("hello")).toBe(true);
    expect(isJsonPrimitive(42)).toBe(true);
    expect(isJsonPrimitive(true)).toBe(true);
  });

  it("rejects non-finite numbers", () => {
    expect(isJsonPrimitive(NaN)).toBe(false);
    expect(isJsonPrimitive(Infinity)).toBe(false);
    expect(isJsonPrimitive(-Infinity)).toBe(false);
  });
});
