// The prompts a visitor pastes to their coding agent. Visitors read them before
// pasting, so they are written as something a person would plausibly type:
// the situation, the goal, the constraints. Literal values only where precision
// matters.

// One version for the browser embed and the MCP server the visitor installs.
export const relayPackage = "@mcp-b/webmcp-local-relay@5.1.0";

// Self-routing: the visitor pastes it before and after restarting the agent.
export const setupPrompt = (pageUrl: string, origin: string) =>
  `I'm trying the Ayme WebMCP playground at ${pageUrl}.

If you don't have a webmcp_list_sources tool yet, add the WebMCP local relay as an MCP server. Use your own MCP configuration format, user-level if possible:

  command: npx
  args:    -y ${relayPackage} --widget-origin ${origin}

If you already have it, call webmcp_list_sources and webmcp_list_tools and show me the tools the page exposes.`;

// For a relay that answers but refuses this origin. The relay listens on one
// local port, first come first served, so the refusing relay may belong to
// another program even when this agent's configuration is right.
export const repairPrompt = (origin: string) =>
  `The WebMCP local relay refused the page at ${origin}. It only accepts the origin it was started with.

In your MCP configuration, change the webmcp-local-relay server's --widget-origin to ${origin}. If another process is blocking the relay's port, help me resolve it.`;
