#!/usr/bin/env node
import { startMcpServer } from "./server";

const [command] = process.argv.slice(2);
if (command === "mcp") {
  await startMcpServer();
} else {
  process.stderr.write(
    "Usage: ayme mcp\n\n  mcp  Start the Ayme MCP server for a coding agent, over stdio.\n"
  );
  process.exitCode = 1;
}
