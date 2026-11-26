/// <reference types="webmcp-types" preserve="true" />
// Test support (ADR-0057): a recording WebMCP driver for Playwright
// tests, which only tests may import. The helpers receive the test's own
// `Page` and `BrowserContext`; `e2e` has a subset of them on e2e's `browser`. The reference above declares
// `document.modelContext` for the tests that import this entry.
import type { BrowserContext, Page } from "@playwright/test";

import {
  installRecordingDriver,
  type RecordingDriver,
} from "./recordingDriver";

export type { PublishedTool, RecordingDriver } from "./recordingDriver";
/** A subset of these helpers on the e2e runner's `browser`, for its suites. */
export * as e2e from "./e2e";

/** Install a minimal `document.modelContext` that records what the ayme
 *  runtime publishes, so a test can read and execute the published tools. */
export async function recordPublishedTools(context: BrowserContext) {
  await context.addInitScript(installRecordingDriver);
}

/** Install the same recording driver into the page's current document, after
 *  it loaded: for a test of a driver that appears after ayme's initial wait,
 *  followed by `retryPublication`. */
export async function recordPublishedToolsLate(page: Page) {
  await page.evaluate(installRecordingDriver);
}

/** The names of the tools published right now, in publication order. */
export function publishedToolNames(page: Page) {
  return page.evaluate(() =>
    (document.modelContext as unknown as RecordingDriver).tools.map(
      (tool) => tool.name
    )
  );
}

/**
 * One published tool's name, description, schema and, when it has any, its
 * annotations; `null` while it is not published.
 */
export function publishedToolSchema(page: Page, name: string) {
  return page.evaluate((name) => {
    const tool = (
      document.modelContext as unknown as RecordingDriver
    ).tools.find((candidate) => candidate.name === name);
    return tool
      ? {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        }
      : null;
  }, name);
}

/** Wait until one tool is published; fails within the given time, so a
 *  publication failure is reported as such and not as the test's timeout. */
export function waitForPublishedTool(
  page: Page,
  name: string,
  { timeout = 15_000 } = {}
) {
  return page.waitForFunction(
    (name) =>
      (document.modelContext as unknown as RecordingDriver).tools.some(
        (tool) => tool.name === name
      ),
    name,
    { timeout }
  );
}

/** Execute one published tool from the page. */
export function executePublishedTool(page: Page, name: string, args = {}) {
  return page.evaluate(
    async ({ name, args }) => {
      const tool = (
        document.modelContext as unknown as RecordingDriver
      ).tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} is not published.`);
      return await tool.execute(args);
    },
    { name, args }
  );
}
