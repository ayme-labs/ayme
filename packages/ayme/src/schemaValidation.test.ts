import { describe, expect, it } from "vitest";

import type { JsonSchema } from "./contracts";
import { ToolInputError } from "./errors";
import { validatedToolInput } from "./elementTools";
import { toolInputViolations } from "./schemaValidation";

const goalSchema: JsonSchema = {
  type: "object",
  properties: {
    goal: { type: "string" },
    maxSteps: { type: "integer", minimum: 1 },
    level: { type: "string", enum: ["low", "high"] },
    tags: { type: "array", items: { type: "string" } },
    values: {
      type: "object",
      additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }] },
      minProperties: 1,
      maxProperties: 2,
    },
    address: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
  },
  required: ["goal", "maxSteps"],
};

describe("toolInputViolations", () => {
  it("finds nothing in valid input", () => {
    expect(
      toolInputViolations(goalSchema, {
        goal: "Sign up",
        maxSteps: 3,
        level: "low",
        tags: ["a"],
        values: { zip: "02134", age: 3 },
        address: { city: "Boston" },
      })
    ).toEqual([]);
  });

  it("lists every violation by its path", () => {
    expect(
      toolInputViolations(goalSchema, {
        maxSteps: 1.5,
        level: "medium",
        tags: ["a", 2],
        values: { zip: true },
        address: { town: "Boston" },
        extra: 1,
      })
    ).toEqual([
      { path: "maxSteps", message: "must be an integer" },
      { path: "level", message: "must be one of low, high" },
      { path: "tags[1]", message: "must be a string" },
      { path: "values.zip", message: "must be a string or a number" },
      { path: "address.town", message: "is not supported" },
      { path: "address.city", message: "is required" },
      { path: "extra", message: "is not supported" },
      { path: "goal", message: "is required" },
    ]);
  });

  it("checks a map's number of entries and a number's minimum", () => {
    expect(
      toolInputViolations(goalSchema, {
        goal: "Sign up",
        maxSteps: 0,
        values: { a: 1, b: 2, c: 3 },
      })
    ).toEqual([
      { path: "maxSteps", message: "must be at least 1" },
      { path: "values", message: "must have at most 2 entries" },
    ]);
    expect(
      toolInputViolations(goalSchema, { goal: "x", maxSteps: 1, values: {} })
    ).toEqual([{ path: "values", message: "must have at least 1 entry" }]);
  });

  it("rejects a name the schema doesn't declare, even an inherited one", () => {
    expect(
      toolInputViolations(
        { type: "object", properties: {} },
        {
          constructor: 1,
        }
      )
    ).toEqual([{ path: "constructor", message: "is not supported" }]);
  });

  it("applies a schema's own keywords beside its anyOf", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        count: {
          type: "number",
          minimum: 1,
          anyOf: [{ type: "integer" }, { type: "number" }],
        },
      },
    };
    expect(toolInputViolations(schema, { count: 0 })).toEqual([
      { path: "count", message: "must be at least 1" },
    ]);
    expect(toolInputViolations(schema, { count: 2 })).toEqual([]);
  });

  it("checks an array and each of its items", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      },
    };
    expect(toolInputViolations(schema, { tags: ["a", "b"] })).toEqual([]);
    expect(toolInputViolations(schema, { tags: "a" })).toEqual([
      { path: "tags", message: "must be an array" },
    ]);
    expect(toolInputViolations(schema, { tags: ["a", "c"] })).toEqual([
      { path: "tags[1]", message: "must be one of a, b" },
    ]);
  });

  it("checks a tuple's elements and length", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        point: {
          type: "array",
          prefixItems: [{ type: "number" }, { type: "string" }],
          minItems: 1,
          maxItems: 2,
        },
        path: {
          type: "array",
          prefixItems: [{ type: "string" }],
          items: { type: "number" },
        },
      },
    };
    expect(
      toolInputViolations(schema, { point: [1, "a"], path: ["a", 1, 2] })
    ).toEqual([]);
    expect(toolInputViolations(schema, { point: [1] })).toEqual([]);
    expect(
      toolInputViolations(schema, { point: ["a", "b", "c"], path: ["a", "b"] })
    ).toEqual([
      { path: "point[0]", message: "must be a number" },
      { path: "point", message: "must have at most 2 items" },
      { path: "path[1]", message: "must be a number" },
    ]);
    expect(toolInputViolations(schema, { point: [] })).toEqual([
      { path: "point", message: "must have at least 1 item" },
    ]);
  });

  it("takes null where a union allows it", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { note: { anyOf: [{ type: "null" }, { type: "string" }] } },
    };
    expect(toolInputViolations(schema, { note: null })).toEqual([]);
    expect(toolInputViolations(schema, { note: "a" })).toEqual([]);
    expect(toolInputViolations(schema, { note: 1 })).toEqual([
      { path: "note", message: "must be null or a string" },
    ]);
  });

  it("takes an inherited name as missing, not given", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: Object.fromEntries([
        ["constructor", { type: "string" as const }],
      ]),
      required: ["constructor"],
    };
    expect(toolInputViolations(schema, {})).toEqual([
      { path: "constructor", message: "is required" },
    ]);
  });

  it("rejects a number JSON overflows to Infinity", () => {
    expect(
      toolInputViolations(goalSchema, {
        goal: "x",
        maxSteps: 1,
        values: { amount: JSON.parse("1e400") as number },
      })
    ).toEqual([
      { path: "values.amount", message: "must be a string or a number" },
    ]);
  });

  it("rejects input that isn't an object", () => {
    expect(toolInputViolations(goalSchema, [])).toEqual([
      { path: "", message: "must be an object" },
    ]);
  });
});

describe("validatedToolInput", () => {
  it("throws the first violation with its path", () => {
    expect(() =>
      validatedToolInput(goalSchema, {
        goal: "x",
        maxSteps: 1,
        values: { zip: true },
      })
    ).toThrow(
      new ToolInputError(
        "Input property values.zip must be a string or a number."
      )
    );
    expect(() => validatedToolInput(goalSchema, "x")).toThrow(
      "Tool input must be an object."
    );
  });
});
