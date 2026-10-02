import { afterAll, beforeAll, expect } from "vitest";
import {
  cleanupWebMCPPolyfill,
  initializeWebMCPPolyfill,
} from "@mcp-b/webmcp-polyfill";

import { describeToolFailures } from "./toolFailures.scenario";

beforeAll(() => {
  expect(document.modelContext).toBeUndefined();
  initializeWebMCPPolyfill();
});

afterAll(() => {
  cleanupWebMCPPolyfill();
});

describeToolFailures("the WebMCP polyfill", () => document.modelContext!);
