#!/usr/bin/env node
import { readCommand, startMcpServer } from "./server";

const command = readCommand(process.argv.slice(2));
if (command.kind === "help") {
  process.stdout.write(command.text);
} else if (command.kind === "error") {
  process.stderr.write(command.text);
  process.exitCode = 1;
} else {
  await startMcpServer(command).catch((error: unknown) => {
    process.stderr.write(`[ayme mcp] ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
