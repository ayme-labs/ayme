/**
 * Test support: the MCP failure result an agent gets for a failing call, as
 * `@ayme-dev/webmcp` returns it and `agentTools().call` in
 * publication.testSupport.ts does. `text` may be an asymmetric matcher.
 */
export const toolFailure = (text: unknown) => ({
  content: [{ type: "text", text }],
  isError: true,
});
