import { parseArgs } from "node:util";

export const USAGE = `Usage: ayme-recorder codegen <url> [--headless | --headed]
       ayme-recorder codegen --cdp-endpoint <address>
       ayme-recorder trace <target>
       ayme-recorder install [browser]

  codegen <url>  Open the page in Chromium, with the Playwright installed in
                 the project this runs in.
  --headless     Open Chromium without a visible window.
  --headed       Open Chromium with a window. This is the default.
  --cdp-endpoint <address>
                 Record the page of a Chromium that is already running, at
                 the address of its DevTools protocol on this machine, such
                 as http://127.0.0.1:9222. The page is not navigated, and the
                 browser stays open when the recorder ends.
  trace <target> Open a recording's trace with the project's own
                 npx playwright trace: <target> is latest, a recording id or
                 the path of a trace file. Any other trace command, such as
                 trace actions, is passed on to it as it is.
  install [browser]
                 Install a browser with the project's own Playwright, as its
                 npx playwright install does: chromium unless you name
                 another, and its own flags, such as --with-deps, as they
                 are.
  -h, --help     Print this usage text.
`;

/**
 * What `ayme-recorder` was asked to do: record a page, print help, or fail
 * with a message.
 */
export type Command =
  | { kind: "codegen"; url: string; headless?: boolean }
  | { kind: "trace"; args: string[] }
  | { kind: "install"; args: string[] }
  | { kind: "help"; text: string }
  | { kind: "error"; text: string }
  | { kind: "attach"; cdpEndpoint: string };

/** The command the arguments (without the node and script paths) ask for. */
export function readCommand(args: string[]): Command {
  // The stock tool's own words and flags: none of them is read here.
  if (args[0] === "trace") return { kind: "trace", args: args.slice(1) };
  if (args[0] === "install") return readInstall(args.slice(1));
  return readCodegen(args);
}

/** `install`: the browser and flags for the project's own Playwright, which
 * installs Chromium, the browser the recorder records in, unless told. */
function readInstall(args: string[]): Command {
  return { kind: "install", args: args.length > 0 ? args : ["chromium"] };
}

/** What `parseArgs` reads of the options `codegen` knows. */
type Flags = {
  help?: boolean;
  headless?: boolean;
  headed?: boolean;
  "cdp-endpoint"?: string;
};

const fail = (message: string): Command => ({
  kind: "error",
  text: `${message}\n\n${USAGE}`,
});

/** `codegen`, or anything else this is not: its options and words. */
function readCodegen(args: string[]): Command {
  let positionals: string[];
  let values: Flags;
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        headless: { type: "boolean" },
        headed: { type: "boolean" },
        "cdp-endpoint": { type: "string" },
      },
    }));
  } catch (error) {
    return fail((error as Error).message);
  }
  if (values.help) return { kind: "help", text: USAGE };
  return flagConflict(values) ?? codegenCommand(positionals, values);
}

/** The error for options that cannot go together, if any do. */
function flagConflict(values: Flags): Command | undefined {
  if (values.headless && values.headed)
    return fail("Give either --headless or --headed, not both.");
  if (
    values["cdp-endpoint"] !== undefined &&
    (values.headless || values.headed)
  )
    return fail(
      "--headless and --headed apply when the recorder opens the browser, not with --cdp-endpoint."
    );
  return undefined;
}

/** The words after the options: `codegen <url>`, or `codegen
 * --cdp-endpoint <address>`. */
function codegenCommand(positionals: string[], values: Flags): Command {
  const [word, url, ...more] = positionals;
  const cdpEndpoint = values["cdp-endpoint"];
  if (word !== "codegen") return { kind: "error", text: USAGE };
  if (cdpEndpoint !== undefined) {
    if (url === undefined) return { kind: "attach", cdpEndpoint };
    if (more.length === 0)
      return fail(
        "Give either a URL or --cdp-endpoint, not both: attaching never navigates the page."
      );
  }
  if (url === undefined || more.length > 0)
    return { kind: "error", text: USAGE };
  return values.headless || values.headed
    ? { kind: "codegen", url, headless: values.headless === true }
    : { kind: "codegen", url };
}
