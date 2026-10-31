import { parseArgs } from "node:util";

export const USAGE = `Usage: ayme mcp [--port <port>]

  mcp            Start the Ayme MCP server for a coding agent, over stdio.
  --port <port>  Listen for pages on this port only, instead of the first
                 free one from 9350 to 9365.
  -h, --help     Print this usage text.
`;

/** What `ayme` was asked to do: start the server, print help, or fail with a message. */
export type Command =
  | { kind: "start"; port?: number }
  | { kind: "help"; text: string }
  | { kind: "error"; text: string };

/** The command the arguments (without the node and script paths) ask for. */
export function readCommand(args: string[]): Command {
  let positionals: string[];
  let values: { port?: string; help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        port: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    return { kind: "error", text: `${(error as Error).message}\n\n${USAGE}` };
  }
  if (values.help) return { kind: "help", text: USAGE };
  if (positionals.length !== 1 || positionals[0] !== "mcp")
    return { kind: "error", text: USAGE };
  if (values.port === undefined) return { kind: "start" };
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return {
      kind: "error",
      text: `--port expects a port number, got "${values.port}".\n\n${USAGE}`,
    };
  return { kind: "start", port };
}
