#!/usr/bin/env node
import { Console } from "node:console";

import { printInspectorUrl, readCommand, startMcpServer } from "./server";

const command = readCommand(process.argv.slice(2));
if (command.kind === "help") {
  process.stdout.write(command.text);
} else if (command.kind === "error") {
  process.stderr.write(command.text);
  process.exitCode = 1;
} else if (command.kind === "inspect") {
  process.exitCode = await printInspectorUrl(command);
} else {
  // Stdout carries MCP: whatever else logs, such as the build plugin while
  // it builds the Page Objects entry, logs to stderr.
  globalThis.console = new Console(process.stderr, process.stderr);
  await startMcpServer(command).catch((error: unknown) => {
    process.stderr.write(`[ayme mcp] ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
