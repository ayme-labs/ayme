import { parseArgs } from "node:util";
import type { SessionRequest } from "@ayme-dev/session";

export const USAGE = `Usage: ayme capture <url> [--headless] [--start-recording]
                    [--load-storage <file>] [--save-storage <file>]
       ayme capture --cdp=<url>
       ayme open [url] [--headed]
       ayme attach --cdp=<url>
       ayme page-objects [--tab=<url>]
       ayme tools [--tab=<url>]
       ayme call <tool> [--params <json> | --params @<file>] [--tab=<url>]
       ayme inspect
       ayme mcp
       ayme detach
       ayme close
       ayme list

  open [url]     Start a Session in this folder: open Chromium with the
                 Playwright installed in the project this runs in, at <url>
                 when given, and print the address your browser automation
                 connects to.
  --headed       Open that Chromium with a visible window.
  attach --cdp=<url>
                 Start a Session in this folder on a Chromium that is
                 already running, at the address of its DevTools protocol,
                 such as http://127.0.0.1:9222.
  page-objects   Print the Page Object Tree of the Session's Tab: its Page
                 Objects, with the id of each one that has a root, and how
                 many tools they have.
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
                 Read that JSON object from <file>, a regular file of at most
                 1 MiB. A relative <file> starts at the project's folder.
  --tab=<url>    Work on the most recently active tab whose page shows
                 exactly <url>, as the first line of ayme page-objects prints
                 it, and not on the browser's most recently active tab. A
                 call of a tool that takes a Page Object Id runs on the tab
                 of that Page Object: leave --tab out of it.
  inspect        Ask your default browser to open the Inspector on the
                 Session: the Page Objects and the tools of the Session's
                 tab, to run by hand. When it opens in the Session's browser,
                 ayme leaves its tab out of the Session's tabs. The address
                 opens one window, within five minutes: run ayme inspect
                 again for another. BROWSER=none only prints the address;
                 another BROWSER names the program that opens it.
  mcp            Serve MCP over stdio, for an Agent App to start: it shows
                 the Inspector on the Session in the Agent App's chat, if
                 the Agent App shows MCP Apps. It offers no tool that reads
                 or acts on the page: run ayme page-objects, ayme tools and
                 ayme call for that.
  detach         End a Session started with attach, and leave its browser
                 running.
  close          End the Session, and close its browser if ayme opened it.
  list           List the Sessions of this folder.
  -s=<name>      Name the Session a command starts or reaches, so that a
                 folder can have several. AYME_SESSION names it too; without
                 either, its name is default.
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
                 When the recorder ends with Finish, with its last recorded
                 page closed or with Ctrl+C, save the browser's cookies and
                 local storage to <file>, in the same format, also when
                 nothing was recorded. When the browser was quit or the save
                 fails, it prints a warning instead.
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
  | ({
      kind: "open";
      open: { readonly url?: string; readonly headed: boolean };
      json: boolean;
    } & Named)
  | ({ kind: "attach"; cdp: string; json: boolean } & Named)
  | ({ kind: "ask"; request: SessionRequest; json: boolean } & Named)
  /** `ayme call`: the tool, and its `--params` as given, JSON or
   * `@<file>`. */
  | ({
      kind: "call";
      tool: string;
      params?: string;
      /** The URL of the Tab `--tab` names. */
      tab?: string;
      json: boolean;
    } & Named)
  | { kind: "list"; json: boolean }
  /** `ayme inspect`: the Inspector window of the Session. */
  | ({ kind: "inspect"; json: boolean } & Named)
  /** `ayme mcp`: the Inspector of the Session in an Agent App's chat. */
  | ({ kind: "mcp" } & Named)
  /** The Session's background process, which `open` starts with the
   * options it was given, as JSON. */
  | { kind: "session process"; options: string }
  | { kind: "help"; text: string }
  | { kind: "version" }
  | { kind: "error"; text: string };

/** The Session a command names, when it names one. */
type Named = { session?: string };

/** The command the arguments (without the node and script paths) ask for,
 * with the environment's AYME_SESSION naming a Session that -s does not. */
export function readCommand(
  args: string[],
  { AYME_SESSION }: { AYME_SESSION?: string | undefined } = {}
): Command {
  // By itself only: beside a command it is an option the command lacks.
  if (args.length === 1 && args[0] === "--version") return { kind: "version" };
  if (args[0] === SESSION_PROCESS && args.length === 2)
    return { kind: "session process", options: args[1]! };
  // The first word that is no option, nor the name after a bare -s.
  const word = args.find(
    (arg, at) =>
      !arg.startsWith("-") && !["-s", "--session"].includes(args[at - 1] ?? "")
  );
  if (word !== undefined && Object.hasOwn(SESSION_COMMANDS, word))
    return readSessionCommand(args, AYME_SESSION);
  return readCapture(args);
}

/** The options of a Session's commands beyond the global --json and -s. */
type SessionOption = "headed" | "cdp" | "params" | "tab";
const SESSION_OPTIONS: readonly SessionOption[] = [
  "headed",
  "cdp",
  "params",
  "tab",
];

/** The commands of a Session, each with the options it `takes`, and what
 * it `asks` the folder's Session when it only asks it; the others are read
 * on their own. An option a command does not take is refused. */
const SESSION_COMMANDS: Readonly<
  Record<
    string,
    {
      readonly takes: readonly SessionOption[];
      readonly asks?: SessionRequest;
    }
  >
> = {
  open: { takes: ["headed"] },
  attach: { takes: ["cdp"] },
  list: { takes: [] },
  call: { takes: ["params", "tab"] },
  inspect: { takes: [] },
  mcp: { takes: [] },
  // Each asks for the listing of the Tab --tab names.
  "page-objects": { takes: ["tab"] },
  tools: { takes: ["tab"] },
  close: { takes: [], asks: { stop: {} } },
  detach: { takes: [], asks: { detach: {} } },
};

/** The word the Session's background process is started with. */
export const SESSION_PROCESS = "__session";

/** `open [url] [--headed]`, `attach --cdp=<url>`, `list`, or a command
 * that only asks the Session, each with the global --json and -s. */
function readSessionCommand(
  args: string[],
  fromEnvironment: string | undefined
): Command {
  let positionals: string[];
  let values: {
    help?: boolean;
    headed?: boolean;
    json?: boolean;
    cdp?: string;
    session?: string;
    params?: string;
    tab?: string;
  };
  try {
    ({ positionals, values } = parseArgs({
      // Playwright CLI's `-s=<name>`, which parseArgs reads as the value
      // "=<name>".
      args: args.map((arg) =>
        arg.startsWith("-s=") ? `--session=${arg.slice(3)}` : arg
      ),
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        headed: { type: "boolean" },
        json: { type: "boolean" },
        cdp: { type: "string" },
        session: { type: "string", short: "s" },
        params: { type: "string" },
        tab: { type: "string" },
      },
    }));
  } catch (error) {
    return fail((error as Error).message);
  }
  if (values.help) return { kind: "help", text: USAGE };
  if (values.session === "") return fail("Give -s the name of a Session.");
  if (values.tab === "")
    return fail(
      "Give --tab the URL a tab shows, as the first line of ayme page-objects prints it."
    );
  const [word, url, ...more] = positionals;
  const json = values.json ?? false;
  const session = values.session ?? (fromEnvironment || undefined);
  const named = session === undefined ? {} : { session };
  if (word === "attach" && values.cdp === undefined)
    return fail(
      "Give ayme attach the address of the browser's DevTools protocol, such as --cdp=http://127.0.0.1:9222."
    );
  // `word` is one of SESSION_COMMANDS: readCommand sent it here.
  const { takes, asks } = SESSION_COMMANDS[word!]!;
  if (
    SESSION_OPTIONS.some(
      (option) => values[option] !== undefined && !takes.includes(option)
    )
  )
    return { kind: "error", text: USAGE };
  const { cdp, params, tab } = values;
  const onTab = tab === undefined ? {} : { tab };
  if (word === "attach" && url === undefined)
    return { kind: "attach", cdp: cdp!, json, ...named };
  if (word === "call")
    return url !== undefined && more.length === 0
      ? {
          kind: "call",
          tool: url,
          ...(params === undefined ? {} : { params }),
          ...onTab,
          json,
          ...named,
        }
      : { kind: "error", text: USAGE };
  if ((word === "page-objects" || word === "tools") && url === undefined)
    return {
      kind: "ask",
      request: word === "tools" ? { tools: onTab } : { pageObjects: onTab },
      json,
      ...named,
    };
  if (word === "open" && more.length === 0)
    return {
      kind: "open",
      open: {
        ...(url !== undefined ? { url } : {}),
        headed: values.headed ?? false,
      },
      json,
      ...named,
    };
  if (url !== undefined) return { kind: "error", text: USAGE };
  if (word === "list") return { kind: "list", json };
  if (word === "inspect") return { kind: "inspect", json, ...named };
  // Its answers go to an Agent App, which reads MCP, not --json.
  if (word === "mcp")
    return json ? { kind: "error", text: USAGE } : { kind: "mcp", ...named };
  if (asks) return { kind: "ask", request: asks, json, ...named };
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
