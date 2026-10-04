// The prompt a visitor pastes to their coding agent. Visitors read it before
// pasting, so it is written as something a person would plausibly type: the
// situation, the goal, the constraints. Literal values only where precision
// matters.

// Ayme's MCP server, pinned to the installed version of `@ayme-dev/mcp`,
// which `vite/mcpVersion.ts` defines at build time.
export const mcpPackage = `@ayme-dev/mcp@${__AYME_MCP_VERSION__}`;

// Self-routing: the visitor pastes it before and after restarting the agent.
export const setupPrompt = (pageUrl: string) =>
  `I'm trying the Ayme playground at ${pageUrl}.

If you don't have an ayme_connect tool yet, add Ayme's MCP server as a stdio MCP server. Use your own MCP configuration format:

  command: npx
  args:    -y ${mcpPackage} mcp

If you already have it, call ayme_connect with ${pageUrl} and give me the link it returns, so I can open it in my tab. Once the page is connected, show me the tools it exposes.`;
