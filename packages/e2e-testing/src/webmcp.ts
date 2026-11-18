import type { Browser } from "@e2e-dev/web";
import type { JsonValue } from "e2e";

// The recording WebMCP driver of `@ayme-dev/webmcp/testing`, on e2e's
// `browser`. The two must agree on the driver's shape; this package depends
// on no Ayme package (a `tooling` package may not), so the type is repeated.

export type PublishedTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  /** Only on a tool marked destructive: `{ consequentialHint: true }`. */
  annotations?: { consequentialHint?: boolean };
  execute(args: unknown): Promise<unknown>;
};

export type RecordingDriver = { tools: PublishedTool[] };

// Runs in the browser, so it uses nothing from this module's scope.
function installRecordingDriver() {
  const publishedTools: PublishedTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: false,
    value: {
      tools: publishedTools,
      async registerTool(
        tool: PublishedTool,
        { signal }: { signal: AbortSignal }
      ) {
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
    },
  });
}

/**
 * Installs a minimal `document.modelContext` that records what the Ayme
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
