import { afterAll, beforeAll, expect } from "vitest";
import {
  cleanupWebMCPPolyfill,
  initializeWebMCPPolyfill,
} from "@mcp-b/webmcp-polyfill";

import { describePublishedTools } from "./publishedTools.scenario";

beforeAll(() => {
  expect(document.modelContext).toBeUndefined();
  initializeWebMCPPolyfill();
});

afterAll(() => {
  cleanupWebMCPPolyfill();
});

describePublishedTools("the WebMCP polyfill", () => document.modelContext!);
