// The recording WebMCP driver both runners' helpers install: a minimal
// `document.modelContext` that keeps what the ayme runtime publishes.

export type PublishedTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  /** Only on a tool marked destructive: `{ consequentialHint: true }`. */
  annotations?: { consequentialHint?: boolean };
  execute(args: unknown): Promise<unknown>;
};

export type RecordingDriver = {
  tools: PublishedTool[];
};

// Runs in the browser, so it uses nothing from this module's scope.
export function installRecordingDriver() {
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
}
