import type { ChromeModelContextExtensions } from "@mcp-b/webmcp-types";
import { beforeAll, expect } from "vitest";

import { describeToolFailures } from "./toolFailures.scenario";

// Runs in the "native-webmcp" browser project, which launches Chromium with
// --enable-features=WebMCP,WebMCPTesting (vitest.browser.config.ts).
beforeAll(() => {
  const context = document.modelContext as
    ChromeModelContextExtensions | undefined;
  expect(context?.executeTool).toBeTypeOf("function");
});

describeToolFailures("native WebMCP", () => document.modelContext!);
