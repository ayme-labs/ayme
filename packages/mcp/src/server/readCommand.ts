import { parseArgs } from "node:util";

export const USAGE = `Usage: ayme mcp [--port <port>]
       ayme inspect [--port <port>]

  mcp            Start the Ayme MCP server for a coding agent, over stdio.
  inspect        Print the URL of the Ayme Inspector of the running server.
                 Needs the optional package @ayme-dev/inspector.
  --port <port>  Listen for pages on this port only, instead of the first
                 free one from 9350 to 9365; with inspect, look for the
                 server on this port only.
  -h, --help     Print this usage text.
`;

/**
 * What `ayme` was asked to do: start the server, print the Inspector's URL,
 * print help, or fail with a message.
 */
export type Command =
  | { kind: "start"; port?: number }
  | { kind: "inspect"; port?: number }
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
  const [word] = positionals;
  const kind =
    positionals.length !== 1
      ? undefined
      : word === "mcp"
        ? "start"
        : word === "inspect"
          ? "inspect"
          : undefined;
  if (!kind) return { kind: "error", text: USAGE };
  if (values.port === undefined) return { kind };
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return {
      kind: "error",
      text: `--port expects a port number, got "${values.port}".\n\n${USAGE}`,
    };
  return { kind, port };
}
