import { expect, it } from "vitest";

import {
  HelloSchema,
  PageLeavingSchema,
  PageToolSchema,
  PageWelcomeSchema,
  ProcessToolCallSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
} from "./messages";

it.each([
  [
    "a page tool",
    PageToolSchema,
    { name: "peek", description: "Reads", inputSchema: { type: "object" } },
  ],
  ["a tool call", ToolCallSchema, { callId: "1", name: "peek", input: {} }],
  ["a result", ToolCallOutcomeSchema, { callId: "1", ok: true, result: 2 }],
  ["a failure", ToolCallOutcomeSchema, { callId: "1", ok: false, error: "x" }],
  ["a process tool call", ProcessToolCallSchema, { name: "peek", input: 1 }],
  ["a page's hello", HelloSchema, { tab: "a", url: "http://localhost/" }],
  ["a process's hello", HelloSchema, { process: "server" }],
  ["a welcome", PageWelcomeSchema, { token: "f00d" }],
  ["a page leaving", PageLeavingSchema, { url: "http://x/", reload: true }],
])("keeps every field of %s", (_label, schema, message) => {
  expect(schema.parse(message)).toEqual(message);
});

it("rejects an outcome whose `ok` does not match its fields", () => {
  for (const outcome of [
    { callId: "1", ok: true, error: "x" },
    { callId: "1", ok: false, result: 2 },
  ])
    expect(
      ToolCallOutcomeSchema.safeParse(outcome).success,
      outcome.ok + ""
    ).toBe(false);
});
