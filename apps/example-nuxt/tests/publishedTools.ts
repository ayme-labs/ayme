// Twin of apps/example-next/tests/publishedTools.ts: the apps share no test
// package, so the two stay in step: a change here belongs there too.
import type { BrowserContext, Page } from "@playwright/test";

export type PublishedTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(args: unknown): Promise<unknown>;
};

export type RecordingDriver = {
  tools: PublishedTool[];
};

/** Install a minimal `document.modelContext` that records what the Ayme
 *  runtime publishes, so a test can read and execute the published tools. */
export async function recordPublishedTools(context: BrowserContext) {
  await context.addInitScript(() => {
    const publishedTools: PublishedTool[] = [];
    const driver: RecordingDriver & {
      registerTool(
        tool: PublishedTool,
        options: { signal: AbortSignal }
      ): Promise<void>;
    } = {
      tools: publishedTools,
      async registerTool(tool, { signal }) {
        publishedTools.push(tool);
        signal.addEventListener(
          "abort",
          () => {
            const index = publishedTools.indexOf(tool);
            if (index >= 0) publishedTools.splice(index, 1);
          },
          { once: true }
        );
      },
    };
    Object.defineProperty(document, "modelContext", {
      configurable: false,
      value: driver,
    });
  });
}

/** The names of the tools published right now, in publication order. */
export function publishedToolNames(page: Page) {
  return page.evaluate(() =>
    (document.modelContext as unknown as RecordingDriver).tools.map(
      (tool) => tool.name
    )
  );
}

/** One published tool's schema, or `null` while it is not published. */
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
