// The part of the optional @ayme-dev/mcp peer the session uses: its page
// client takes the session and returns what ends the Agent Connection. The
// package builds after this one, so its own types may not exist yet.
declare module "@ayme-dev/mcp/client" {
  export function startAgentConnection(ayme: import("./runtime").Ayme): {
    dispose(): void;
  };
}
