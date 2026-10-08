// The part of the optional @ayme-dev/webmcp peer the session uses. The
// package builds after this one, so its own types may not exist yet.
declare module "@ayme-dev/webmcp" {
  export function startWebMcpPublication(
    tools: {
      list(): readonly {
        name: string;
        description: string;
        inputSchema: object;
      }[];
      subscribe(listener: () => void): () => void;
      run(name: string, input: unknown): Promise<unknown>;
    },
    options: {
      toolNamePrefix?: string;
      signal: AbortSignal;
      onStatus(
        status: Readonly<{
          state: "waiting" | "active" | "unavailable" | "failed";
          message: string;
        }>
      ): void;
    }
  ): { retry(): Promise<void> };
}
