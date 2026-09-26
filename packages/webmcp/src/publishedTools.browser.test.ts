import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupWebMCPPolyfill,
  initializeWebMCPPolyfill,
} from "@mcp-b/webmcp-polyfill";

import {
  listPublishedTools,
  subscribeToPublishedTools,
} from "./publishedTools";
import { createRuntimeSession } from "./runtime";
import { describePublishedTools } from "./publishedTools.scenario";

beforeAll(() => {
  expect(document.modelContext).toBeUndefined();
  initializeWebMCPPolyfill();
});

afterAll(() => {
  cleanupWebMCPPolyfill();
});

describePublishedTools("the WebMCP polyfill", () => document.modelContext!);

// A session's Ref Tools and Goal Loop change the published set without any
// Page Object changing, so subscribers must hear the session start and stop.
describe("the published tool list across a runtime session", () => {
  const sessionTools = () =>
    listPublishedTools()
      .map(({ name }) => name)
      .filter((name) => name === "highlight" || name === "pursue_goal");

  it("tells subscribers when a session starts and stops, and lists its tools only while it runs", () => {
    const runtime = createRuntimeSession({
      refTools: [
        {
          name: "highlight",
          description: "Highlight an element.",
          execute: async () => undefined,
        },
      ],
      goalLoop: () => Promise.reject(new Error("The Goal Loop is not run.")),
    });
    const heard: string[][] = [];
    const unsubscribe = subscribeToPublishedTools(() => {
      heard.push(sessionTools());
    });

    try {
      const stop = runtime.start();
      stop();
    } finally {
      unsubscribe();
    }

    expect(heard.at(0)).toEqual(["highlight", "pursue_goal"]);
    expect(heard.at(-1)).toEqual([]);
  });
});
