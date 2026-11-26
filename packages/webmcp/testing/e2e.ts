import type { Browser } from "@e2e-dev/web";
import type { JsonValue } from "e2e";

import {
  installRecordingDriver,
  type RecordingDriver,
} from "./recordingDriver";

// The recording WebMCP driver's helpers on e2e's `browser`, which hands a
// test no Playwright `Page`; the front door exports them as `e2e`.

/**
 * Installs a minimal `document.modelContext` that records what the ayme
 * runtime publishes, in every document the test opens from now on, so a test
 * can read and execute the published tools.
 */
export function recordPublishedTools(browser: Browser) {
  return browser.addInitScript(installRecordingDriver);
}

/** The names of the tools published right now, in publication order. */
export function publishedToolNames(browser: Browser): Promise<string[]> {
  return browser.evaluate(() =>
    (
      document as unknown as { modelContext: RecordingDriver }
    ).modelContext.tools.map((tool) => tool.name)
  );
}

/**
 * One published tool's name, description, schema and, when it has any, its
 * annotations; `null` while it is not published.
 */
export function publishedToolSchema(browser: Browser, name: string) {
  return browser.evaluate((name: string) => {
    const tool = (
      document as unknown as { modelContext: RecordingDriver }
    ).modelContext.tools.find((candidate) => candidate.name === name);
    // Through JSON: e2e's evaluate passes JSON only, and a schema may hold
    // `undefined`.
    return tool
      ? JSON.parse(
          JSON.stringify({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })
        )
      : null;
  }, name);
}

/** Executes one published tool from the page and resolves with its answer, as JSON. */
export function executePublishedTool(
  browser: Browser,
  name: string,
  args: { [key: string]: JsonValue } = {}
) {
  return browser.evaluate(
    async ({
      name,
      args,
    }: {
      name: string;
      args: { [key: string]: JsonValue };
    }) => {
      const tool = (
        document as unknown as { modelContext: RecordingDriver }
      ).modelContext.tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} is not published.`);
      return JSON.parse(JSON.stringify((await tool.execute(args)) ?? null));
    },
    { name, args }
  );
}
