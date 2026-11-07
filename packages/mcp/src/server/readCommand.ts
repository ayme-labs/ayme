import { parseArgs } from "node:util";

export const USAGE = `Usage: ayme mcp [--port <port>] [--page-objects <file>]
       ayme inspect [--port <port>]

  mcp            Start the Ayme MCP server for a coding agent, over stdio.
  inspect        Print the URL of the Ayme Inspector of the running server.
                 Needs the optional package @ayme-dev/inspector.
  --port <port>  Listen for pages on this port only, instead of the first
                 free one from 9350 to 9365; with inspect, look for the
                 server on this port only.
  --page-objects <file>
                 Experimental: build and serve this entry, whose default
                 export lists Page Object classes, to pages that load
                 .ayme/init-script.js, which the server writes. Without it,
                 the server serves .ayme/page-objects.ts if there is one.
  -h, --help     Print this usage text.
`;

/**
 * What `ayme` was asked to do: start the server, print the Inspector's URL,
 * print help, or fail with a message.
 */
export type Command =
  | { kind: "start"; port?: number; pageObjects?: string }
  | { kind: "inspect"; port?: number }
  | { kind: "help"; text: string }
  | { kind: "error"; text: string };

/** The command the arguments (without the node and script paths) ask for. */
export function readCommand(args: string[]): Command {
  let positionals: string[];
  let values: { port?: string; "page-objects"?: string; help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        port: { type: "string" },
        "page-objects": { type: "string" },
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
  const pageObjects = values["page-objects"];
  if (pageObjects !== undefined && kind !== "start")
    return {
      kind: "error",
      text: `--page-objects is an option of \`ayme mcp\` only.\n\n${USAGE}`,
    };
  const entry = pageObjects === undefined ? {} : { pageObjects };
  if (values.port === undefined) return { kind, ...entry };
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return {
      kind: "error",
      text: `--port expects a port number, got "${values.port}".\n\n${USAGE}`,
    };
  return { kind, port, ...entry };
}
