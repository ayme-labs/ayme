#!/usr/bin/env node
import { Console } from "node:console";

import { isSessionCommand } from "./node-session";

// Spike: the commands of the background process that runs Page Object Tools
// in Node. They and the server are loaded only when asked for, so a thin
// command does not pay for the server's imports.
if (isSessionCommand(process.argv[2])) {
  const { runSessionCommand } = await import("./node-session");
  // The background process stays alive on its socket; a thin command ends.
  process.exitCode = await runSessionCommand(process.argv.slice(2));
} else {
  await runServerCommand();
}

async function runServerCommand() {
  const { printInspectorUrl, readCommand, startMcpServer } =
    await import("./server");
  const command = readCommand(process.argv.slice(2));
  if (command.kind === "help") {
    process.stdout.write(command.text);
  } else if (command.kind === "error") {
    process.stderr.write(command.text);
    process.exitCode = 1;
  } else if (command.kind === "inspect") {
    process.exitCode = await printInspectorUrl(command);
  } else {
    // Stdout carries MCP: whatever else logs, such as the Page Object compiler while
    // it builds the Page Objects entry, logs to stderr.
    globalThis.console = new Console(process.stderr, process.stderr);
    await startMcpServer(command).catch((error: unknown) => {
      process.stderr.write(`[ayme mcp] ${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  }
}
