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
    {
      name: "peek",
      description: "Reads",
      inputSchema: { type: "object" },
      available: true,
    },
  ],
  [
    "an unavailable page tool",
    PageToolSchema,
    {
      name: "Panel.remove",
      description: "Removes",
      inputSchema: { type: "object" },
      available: false,
      reason: "No item is selected",
    },
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

it.each([
  [true, { callId: "1", ok: true, error: "x" }],
  [false, { callId: "1", ok: false, result: 2 }],
])(
  "rejects an outcome with ok=%s and the other branch's fields",
  (_ok, outcome) => {
    expect(ToolCallOutcomeSchema.safeParse(outcome).success).toBe(false);
  }
);
