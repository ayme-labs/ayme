import { parseArgs } from "node:util";

export const USAGE = `Usage: ayme-recorder codegen <url>

  codegen <url>  Open the page in Chromium, with the Playwright installed in
                 the project this runs in.
  -h, --help     Print this usage text.
`;

/**
 * What `ayme-recorder` was asked to do: record a page, print help, or fail
 * with a message.
 */
export type Command =
  | { kind: "codegen"; url: string }
  | { kind: "help"; text: string }
  | { kind: "error"; text: string };

/** The command the arguments (without the node and script paths) ask for. */
export function readCommand(args: string[]): Command {
  let positionals: string[];
  let values: { help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" } },
    }));
  } catch (error) {
    return { kind: "error", text: `${(error as Error).message}\n\n${USAGE}` };
  }
  if (values.help) return { kind: "help", text: USAGE };
  const [word, url, ...more] = positionals;
  if (word !== "codegen" || url === undefined || more.length > 0)
    return { kind: "error", text: USAGE };
  return { kind: "codegen", url };
}
