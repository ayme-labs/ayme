import { beforeAll, expect } from "vitest";

import { describePublishedTools } from "./publishedTools.scenario";

// Runs in the "native-webmcp" browser project, which launches Chromium with
// --enable-features=WebMCP,WebMCPTesting (vitest.browser.config.ts).
beforeAll(() => {
  expect(document.modelContext?.getTools).toBeTypeOf("function");
});

describePublishedTools("native WebMCP", () => document.modelContext!);
