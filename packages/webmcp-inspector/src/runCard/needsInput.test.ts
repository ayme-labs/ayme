import { expect, it } from "vitest";

import { needsInput } from "./needsInput";

// Unit tests: when Run opens the form before it runs the tool.

const noArguments = { type: "object" } as const;
const requiredText = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
} as const;
const optionalNames = {
  type: "object",
  properties: { names: { type: "array", items: { type: "string" } } },
} as const;

it("runs at once when the tool takes nothing", () => {
  expect(
    needsInput({ argumentsSchema: noArguments }, { itemGiven: false })
  ).toBe(false);
});

it("runs at once when every argument is optional", () => {
  expect(
    needsInput({ argumentsSchema: optionalNames }, { itemGiven: false })
  ).toBe(false);
});

it("needs input when an argument is required", () => {
  expect(
    needsInput({ argumentsSchema: requiredText }, { itemGiven: false })
  ).toBe(true);
});

it("needs input when a collection action has no item", () => {
  const archive = {
    argumentsSchema: noArguments,
    collection: "ListPage.items[]",
  };

  expect(needsInput(archive, { itemGiven: false })).toBe(true);
  expect(needsInput(archive, { itemGiven: true })).toBe(false);
});

it("needs input when a collection action on its item has a required argument", () => {
  expect(
    needsInput(
      { argumentsSchema: requiredText, collection: "ListPage.items[]" },
      { itemGiven: true }
    )
  ).toBe(true);
});
