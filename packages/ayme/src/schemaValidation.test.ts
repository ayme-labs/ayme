import { describe, expect, it } from "vitest";

import type { JsonSchema } from "./contracts";
import { ToolInputError } from "./errors";
import { checkedToolInput } from "./schemaValidation";

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

describe("checkedToolInput", () => {
  it("throws a single violation with its path", () => {
    expect(() =>
      checkedToolInput(goalSchema, {
        goal: "x",
        maxSteps: 1,
        values: { zip: true },
      })
    ).toThrow(
      new ToolInputError(
        "Input property values.zip must be a string or a number."
      )
    );
    expect(() => checkedToolInput(goalSchema, "x")).toThrow(
      "Tool input must be an object."
    );
  });

  it("returns only the input's own properties", () => {
    const input = Object.assign(Object.create({ goal: 1 }), {
      goal: "x",
      maxSteps: 1,
    });
    expect(checkedToolInput(goalSchema, input)).toStrictEqual({
      goal: "x",
      maxSteps: 1,
    });
    const optional: JsonSchema = {
      type: "object",
      properties: { values: { type: "object" } },
    };
    expect(
      checkedToolInput(optional, Object.create({ values: { a: true } }))
    ).toStrictEqual({});
    const symbolKeyed = {
      get [Symbol("unread")]() {
        throw new Error("The check never reads a symbol key.");
      },
    };
    expect(checkedToolInput(optional, symbolKeyed)).toStrictEqual({});
  });

  it("takes missing input as {} and refuses null", () => {
    expect(checkedToolInput({ type: "object" }, undefined)).toStrictEqual({});
    expect(() => checkedToolInput(goalSchema, undefined)).toThrow(
      new ToolInputError(
        "Input property goal is required. Input property maxSteps is required."
      )
    );
    expect(() => checkedToolInput({ type: "object" }, null)).toThrow(
      new ToolInputError("Tool input must be an object.")
    );
  });
});
