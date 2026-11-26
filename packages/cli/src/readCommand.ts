import { parseArgs } from "node:util";
import type { SessionRequest } from "@ayme-dev/session";

export const USAGE = `Usage: ayme capture <url> [--headless] [--start-recording]
                    [--load-storage <file>] [--save-storage <file>]
       ayme capture --cdp=<url>
       ayme open [url] [--headed]
       ayme page-objects
       ayme tools
       ayme call <tool> [--params <json> | --params @<file>]
       ayme close

  open [url]     Start a Session in this folder: open Chromium with the
                 Playwright installed in the project this runs in, at <url>
                 when given, and print the address your browser automation
                 connects to.
  --headed       Open that Chromium with a visible window.
  page-objects   Print the Page Object Tree of the Session's Tab: its Page
                 Objects, each with its id, and how many tools they have.
  tools          List every Page Object Tool of the Session's Tab with its
                 parameters, and why a tool is unavailable.
  call <tool>    Run the Page Object Tool <tool> and print what its action
                 returned, the URL when the action changed it, and how the
                 Page Object Tree changed.
  --params <json>
                 The tool's input as one JSON object, as ayme tools prints its
                 parameters: {"id": "<Page Object Id>", "args": {...}} for a
                 tool of a Page Object with an id. Leave it out for a tool
                 that takes none.
  --params @<file>
                 Read that JSON object from <file>.
  close          End this folder's Session and close its browser.
  --json         Print the answer of a Session's command as JSON.

  capture <url>  Record a flow on the page at <url>, opened in Chromium with
                 the Playwright installed in the project this runs in.
  --headless     Open Chromium without a visible window.
  --start-recording
                 Open the recorder already recording, so that the recording
                 and its trace hold the first page load.
  --load-storage <file>
                 Open the page with the cookies and local storage in <file>,
                 a storage state as Playwright writes it, such as one saved
                 with npx playwright codegen --save-storage.
  --save-storage <file>
                 When the recorder ends, however it ends, save the browser's
                 cookies and local storage to <file>, in the same format,
                 also when nothing was recorded.
  --cdp=<url>    Record the page of a Chromium that is already running, at
                 the address of its DevTools protocol on this machine, such
                 as http://127.0.0.1:9222. The page is not navigated, and the
                 browser stays open when the recorder ends.
  -h, --help     Print this usage text.
  --version      Print the installed version.
`;

/** What `ayme capture` records: a page it opens, or a running browser's. */
export type CaptureTarget =
  | {
      readonly url: string;
      readonly headless?: true;
      readonly startRecording?: true;
      readonly loadStorage?: string;
      readonly saveStorage?: string;
    }
  | { readonly cdp: string };

/**
 * What `ayme` was asked to do: record a flow, print help or the version, or
 * fail with a message.
 */
export type Command =
  | { kind: "capture"; target: CaptureTarget }
  | {
      kind: "open";
      open: { readonly url?: string; readonly headed: boolean };
      json: boolean;
    }
  | { kind: "ask"; request: SessionRequest; json: boolean }
  /** `ayme call`: the tool, and its `--params` as given, JSON or
   * `@<file>`. */
  | { kind: "call"; tool: string; params?: string; json: boolean }
  /** The Session's background process, which `open` starts with the
   * options it was given, as JSON. */
  | { kind: "session process"; options: string }
  | { kind: "help"; text: string }
  | { kind: "version" }
  | { kind: "error"; text: string };

/** The command the arguments (without the node and script paths) ask for. */
export function readCommand(args: string[]): Command {
  // By itself only: beside a command it is an option the command lacks.
  if (args.length === 1 && args[0] === "--version") return { kind: "version" };
  if (args[0] === SESSION_PROCESS && args.length === 2)
    return { kind: "session process", options: args[1]! };
  const word = args.find((arg) => !arg.startsWith("-"));
  if (word !== undefined && SESSION_WORDS.has(word))
    return readSessionCommand(args);
  return readCapture(args);
}

/** The commands of a Session. */
const SESSION_WORDS = new Set([
  "open",
  "close",
  "page-objects",
  "tools",
  "call",
]);

/** What each command that only asks the folder's Session asks it. */
const ASKED: Record<string, SessionRequest> = {
  close: { stop: {} },
  "page-objects": { pageObjects: {} },
  tools: { tools: {} },
};

/** The word the Session's background process is started with. */
export const SESSION_PROCESS = "__session";

/** `open [url] [--headed]`, or a command that only asks the Session, each
 * with the global --json. */
function readSessionCommand(args: string[]): Command {
  let positionals: string[];
  let values: {
    help?: boolean;
    headed?: boolean;
    json?: boolean;
    params?: string;
  };
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        headed: { type: "boolean" },
        json: { type: "boolean" },
        params: { type: "string" },
      },
    }));
  } catch (error) {
    return fail((error as Error).message);
  }
  if (values.help) return { kind: "help", text: USAGE };
  const [word, url, ...more] = positionals;
  const json = values.json ?? false;
  const { params } = values;
  if (word === "call")
    return url !== undefined && more.length === 0 && !values.headed
      ? {
          kind: "call",
          tool: url,
          ...(params === undefined ? {} : { params }),
          json,
        }
      : { kind: "error", text: USAGE };
  if (params !== undefined) return { kind: "error", text: USAGE };
  if (word === "open" && more.length === 0)
    return {
      kind: "open",
      open: {
        ...(url !== undefined ? { url } : {}),
        headed: values.headed ?? false,
      },
      json,
    };
  const asked = word === undefined ? undefined : ASKED[word];
  if (asked && url === undefined && !values.headed)
    return { kind: "ask", request: asked, json };
  return { kind: "error", text: USAGE };
}

/** What `parseArgs` reads of the options `capture` knows. */
type Flags = {
  help?: boolean;
  headless?: boolean;
  "start-recording"?: boolean;
  cdp?: string;
  "load-storage"?: string;
  "save-storage"?: string;
};

const fail = (message: string): Command => ({
  kind: "error",
  text: `${message}\n\n${USAGE}`,
});

/** `capture`, or anything else this is not: its options and words. */
function readCapture(args: string[]): Command {
  let positionals: string[];
  let values: Flags;
  try {
    ({ positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        headless: { type: "boolean" },
        "start-recording": { type: "boolean" },
        cdp: { type: "string" },
        "load-storage": { type: "string" },
        "save-storage": { type: "string" },
      },
    }));
  } catch (error) {
    return fail((error as Error).message);
  }
  if (values.help) return { kind: "help", text: USAGE };
  return flagConflict(values) ?? captureCommand(positionals, values);
}

/** The error for options that cannot go together, if any do. */
function flagConflict(values: Flags): Command | undefined {
  if (
    values.cdp !== undefined &&
    (values.headless || values["start-recording"])
  )
    return fail(
      "--headless and --start-recording apply when the recorder opens the browser, not with --cdp."
    );
  if (
    values.cdp !== undefined &&
    (values["load-storage"] !== undefined ||
      values["save-storage"] !== undefined)
  )
    return fail(
      "--load-storage and --save-storage apply when the recorder opens the browser, not with --cdp: the running browser's storage is its own, and saving it would open a page in it."
    );
  if (values["load-storage"] === "" || values["save-storage"] === "")
    return fail("Give --load-storage and --save-storage the name of a file.");
  return undefined;
}

/** The words after the options: `capture <url>`, or `capture --cdp=<url>`. */
function captureCommand(positionals: string[], values: Flags): Command {
  const [word, url, ...more] = positionals;
  const cdp = values.cdp;
  if (word !== "capture") return { kind: "error", text: USAGE };
  if (cdp !== undefined) {
    if (url === undefined) return { kind: "capture", target: { cdp } };
    if (more.length === 0)
      return fail(
        "Give either a URL or --cdp, not both: attaching never navigates the page."
      );
  }
  if (url === undefined || more.length > 0)
    return { kind: "error", text: USAGE };
  return {
    kind: "capture",
    target: {
      url,
      ...(values.headless ? { headless: true as const } : {}),
      ...(values["start-recording"] ? { startRecording: true as const } : {}),
      // Playwright's codegen files.
      ...(values["load-storage"] !== undefined
        ? { loadStorage: values["load-storage"] }
        : {}),
      ...(values["save-storage"] !== undefined
        ? { saveStorage: values["save-storage"] }
        : {}),
    },
  };
}
