#!/usr/bin/env node
import { parseArgs } from "node:util";

import { startMcpServer } from "./server";

const USAGE = `Usage: ayme mcp [--port <port>]

  mcp            Start the Ayme MCP server for a coding agent, over stdio.
  --port <port>  Listen for pages on this port only, instead of the first
                 free one from 9350 to 9365.
`;

/** The `mcp` command's options, or an error message for the user. */
function readCommand(): { port?: number } | string {
  let positionals: string[];
  let port: string | undefined;
  try {
    ({
      positionals,
      values: { port },
    } = parseArgs({
      allowPositionals: true,
      options: { port: { type: "string" } },
    }));
  } catch (error) {
    return `${(error as Error).message}\n\n${USAGE}`;
  }
  if (positionals.length !== 1 || positionals[0] !== "mcp") return USAGE;
  if (port === undefined) return {};
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65_535)
    return `--port expects a port number, got "${port}".\n\n${USAGE}`;
  return { port: number };
}

const command = readCommand();
if (typeof command === "string") {
  process.stderr.write(command);
  process.exitCode = 1;
} else {
  await startMcpServer(command).catch((error: unknown) => {
    process.stderr.write(`[ayme mcp] ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
