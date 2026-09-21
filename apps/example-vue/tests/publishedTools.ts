import type { BrowserContext } from "@playwright/test";

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
 *  runtime publishes, so a test can execute the published tools. */
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
