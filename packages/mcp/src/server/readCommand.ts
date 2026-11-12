import { parseArgs } from "node:util";

export const USAGE = `Usage: ayme mcp [--port <port>] [--page-objects <file>] [--webmcp]
                [--browser-tools]
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
  --webmcp       Pages that load .ayme/init-script.js also publish the
                 tools of the Page Objects the server serves through
                 WebMCP. Needs Page Objects to serve.
  --browser-tools
                 Also list Ayme's own Browser Tools, snapshot, goal and
                 Custom Tools, for an agent with no other browser
                 automation. Without it the server lists the Page Object
                 Tools, page_objects, Peek Tools, App Process tools and
                 its own tools.
  -h, --help     Print this usage text.
`;

/**
 * What `ayme` was asked to do: start the server, print the Inspector's URL,
 * print help, or fail with a message.
 */
export type Command =
  | {
      kind: "start";
      port?: number;
      pageObjects?: string;
      webMCP?: true;
      browserTools?: true;
    }
  | { kind: "inspect"; port?: number }
  | { kind: "help"; text: string }
  | { kind: "error"; text: string };

/** The command the arguments (without the node and script paths) ask for. */
export function readCommand(args: string[]): Command {
  let positionals: string[];
  let values: {
    port?: string;
    "page-objects"?: string;
    webmcp?: boolean;
    "browser-tools"?: boolean;
    help?: boolean;
  };
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        port: { type: "string" },
        "page-objects": { type: "string" },
        webmcp: { type: "boolean" },
        "browser-tools": { type: "boolean" },
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
  const onlyMcp = [
    ...(pageObjects === undefined ? [] : ["--page-objects"]),
    ...(values.webmcp ? ["--webmcp"] : []),
    ...(values["browser-tools"] ? ["--browser-tools"] : []),
  ];
  if (onlyMcp.length > 0 && kind !== "start")
    return {
      kind: "error",
      text: `${onlyMcp[0]} is an option of \`ayme mcp\` only.\n\n${USAGE}`,
    };
  if (pageObjects !== undefined && pageObjects.trim() === "")
    return {
      kind: "error",
      text: `--page-objects expects a file, got an empty value.\n\n${USAGE}`,
    };
  const options = {
    ...(pageObjects === undefined ? {} : { pageObjects }),
    ...(values.webmcp ? { webMCP: true as const } : {}),
    ...(values["browser-tools"] ? { browserTools: true as const } : {}),
  };
  if (values.port === undefined) return { kind, ...options };
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return {
      kind: "error",
      text: `--port expects a port number, got "${values.port}".\n\n${USAGE}`,
    };
  return { kind, port, ...options };
}
