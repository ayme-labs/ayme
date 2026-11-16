/**
 * A stand-in for `ayme mcp` in the startup lane's drive scenarios: it lists
 * the tools a connected page would and nothing else, so the agent routes as
 * it would on a real page, with no browser and no app. A call answers that the
 * tool is a stub; the agent has no permission to make one.
 *
 *   node src/stubMcpServer.ts '<the tools as JSON>'
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { StubTool } from "./scenarios.ts";

const tools = JSON.parse(process.argv[2]) as StubTool[];

const server = new Server(
  { name: "ayme", version: "0.0.0" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map((tool) => ({
    ...tool,
    inputSchema: { type: "object", properties: {} },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, ({ params }) => ({
  content: [{ type: "text", text: `${params.name} is a stub.` }],
}));
await server.connect(new StdioServerTransport());
