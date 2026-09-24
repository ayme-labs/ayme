/**
 * Test support: the MCP failure result a published tool resolves with
 * (`withErrorResult` in webMcp.ts). `text` may be an asymmetric matcher.
 */
export const toolFailure = (text: unknown) => ({
  content: [{ type: "text", text }],
  isError: true,
});
