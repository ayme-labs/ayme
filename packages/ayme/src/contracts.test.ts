import { describe, expect, it } from "vitest";
import { isJsonValue, isJsonPrimitive } from "./contracts";

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

describe("isJsonValue", () => {
  it("accepts plain objects and arrays", () => {
    expect(isJsonValue({ a: 1, b: [true, null, "x"] })).toBe(true);
    expect(isJsonValue([1, "two", { three: 3 }])).toBe(true);
  });

  it("rejects objects with non-JSON values nested inside", () => {
    expect(isJsonValue({ fn: () => {} })).toBe(false);
    expect(isJsonValue({ n: NaN })).toBe(false);
  });

  it("rejects cyclic objects", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(isJsonValue(a)).toBe(false);
  });

  it("rejects cyclic arrays", () => {
    const a: unknown[] = [1];
    a.push(a);
    expect(isJsonValue(a)).toBe(false);
  });

  it("accepts repeated shared references (DAG, not cycle)", () => {
    const shared = { n: 1 };
    expect(isJsonValue({ a: shared, b: shared })).toBe(true);
  });
});
