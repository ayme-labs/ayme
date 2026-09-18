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

Install nothing else and change no project files. Tell me if I need to restart you for it to load.

If you already have it, call webmcp_list_sources and webmcp_list_tools and show me the tools the page exposes. Don't invoke any yet; suggest one I can try. If the page isn't listed, I still need to connect it from "Try with your own coding agent" on the page.`;

// For a relay that answers but refuses this origin.
export const repairPrompt = (origin: string) =>
  `The WebMCP local relay refused the page at ${origin}. It only accepts the origin it was started with.

In your MCP configuration, change the webmcp-local-relay server's --widget-origin to ${origin}.`;
