// Spike: the thin `ayme` commands. Each finds the background process of the
// folder it runs in, sends one request, prints the answer and exits. The
// names and arguments are placeholders: the CLI's interface is not decided.
// Node built-ins only, so a command pays for nothing it does not use.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { sendRequest, type SessionRequest } from "./protocol";
import {
  isAlive,
  logFile,
  readRecord,
  removeRecord,
  type SessionRecord,
} from "./record";

const BACKGROUND = "__background";
const COMMANDS = [
  "attach",
  "detach",
  "page-objects",
  "tools",
  "call",
  BACKGROUND,
];

export const SESSION_USAGE = `Spike, not a settled interface:
       ayme attach --cdp <endpoint> --mark <token> [--page-objects <file>]
       ayme page-objects
       ayme tools
       ayme call <tool> ['<json parameters>']
       ayme detach

  attach         Start Ayme's background process for this folder. It joins
                 the browser at the CDP endpoint and takes the one tab whose
                 window.__aymeMark is the token.
  page-objects   Print the Page Objects on the tab, as page_objects does.
  tools          Print the Page Object Tools, with their parameters.
  call           Call a Page Object Tool; a rooted one takes its Page Object
                 Id as "id".
  detach         Stop the background process.
`;

/** Whether `word` is one of the spike's commands. */
export const isSessionCommand = (word: string | undefined): boolean =>
  word !== undefined && COMMANDS.includes(word);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fail = (text: string) => {
  process.stderr.write(`${text}\n`);
  return 1;
};

const notRunning = (folder: string) =>
  `No Ayme process is running for ${folder}. Start one with \`ayme attach --cdp <endpoint> --mark <token>\`.`;

/** The record of the live process of `folder`; a record whose process is gone is removed. */
function liveRecord(folder: string): SessionRecord | undefined {
  const record = readRecord(folder);
  if (record && !isAlive(record.pid)) {
    removeRecord(folder);
    return undefined;
  }
  return record;
}

async function request(
  folder: string,
  message: SessionRequest
): Promise<number> {
  const record = liveRecord(folder);
  if (!record) return fail(notRunning(folder));
  let response;
  try {
    response = await sendRequest(record.socket, message);
  } catch (error) {
    return fail(
      `The Ayme process for ${folder} (pid ${record.pid}) did not answer: ${(error as Error).message}`
    );
  }
  if (!response.ok) return fail(response.text);
  process.stdout.write(`${response.text}\n`);
  return 0;
}

/** Starts the background process detached, and waits until it listens or exits. */
async function attach(folder: string, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      cdp: { type: "string" },
      mark: { type: "string" },
      "page-objects": { type: "string" },
    },
  });
  if (!values.cdp || !values.mark)
    return fail(
      `attach needs --cdp <endpoint> and --mark <token>.\n\n${SESSION_USAGE}`
    );
  const running = liveRecord(folder);
  if (running)
    return fail(
      `An Ayme process is already running for ${folder} (pid ${running.pid}), on ${running.url}. Stop it with \`ayme detach\` first.`
    );
  const log = logFile(folder);
  // The record's folder holds the log too; a first start creates it.
  removeRecord(folder);
  mkdirSync(dirname(log), { recursive: true });
  const output = openSync(log, "w");
  const child = spawn(
    process.execPath,
    [process.argv[1]!, BACKGROUND, ...args],
    { cwd: folder, detached: true, stdio: ["ignore", output, output] }
  );
  closeSync(output);
  let exited = false;
  child.once("exit", () => (exited = true));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const record = readRecord(folder);
    if (record !== undefined && record.pid === child.pid) {
      child.unref();
      process.stdout.write(
        `Ayme is attached to ${record.url} (pid ${record.pid}).\n`
      );
      return 0;
    }
    if (exited)
      return fail(
        readFileSync(log, "utf8").trim() || "The Ayme process exited."
      );
    await sleep(25);
  }
  child.kill();
  return fail(
    `The Ayme process did not start within 60 seconds. Its log: ${log}`
  );
}

async function detach(folder: string): Promise<number> {
  const record = liveRecord(folder);
  if (!record) return fail(notRunning(folder));
  await sendRequest(record.socket, { method: "stop" }).catch(() => {});
  for (let waited = 0; isAlive(record.pid) && waited < 5000; waited += 25)
    await sleep(25);
  if (isAlive(record.pid)) process.kill(record.pid, "SIGKILL");
  removeRecord(folder);
  process.stdout.write("Stopped.\n");
  return 0;
}

/** Runs one of the spike's commands; resolves with the exit code. */
export async function runSessionCommand(args: string[]): Promise<number> {
  const [word, ...rest] = args;
  const folder = process.cwd();
  try {
    if (word === BACKGROUND) return await background(rest);
    if (word === "attach") return await attach(folder, rest);
    if (word === "detach") return await detach(folder);
    if (word === "page-objects")
      return await request(folder, { method: "page_objects" });
    if (word === "tools") return await request(folder, { method: "tools" });
    const [name, json] = rest;
    if (name === undefined)
      return fail(
        `call needs the name of a Page Object Tool.\n\n${SESSION_USAGE}`
      );
    let input: unknown = {};
    if (json !== undefined)
      try {
        input = JSON.parse(json);
      } catch (error) {
        return fail(`The parameters are not JSON: ${(error as Error).message}`);
      }
    return await request(folder, { method: "call", name, input });
  } catch (error) {
    return fail((error as Error).message);
  }
}

/** The background process itself: what `attach` starts detached. */
async function background(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      cdp: { type: "string" },
      mark: { type: "string" },
      "page-objects": { type: "string" },
    },
  });
  // Loaded here only: the thin commands never load Playwright or esbuild.
  const { runBackground } = await import("./background");
  try {
    await runBackground({
      endpoint: values.cdp!,
      mark: values.mark!,
      pageObjects: values["page-objects"],
    });
  } catch (error) {
    fail((error as Error).message);
    // A connection to the browser may still be open: end it with the process.
    process.exit(1);
  }
  // The socket server keeps the process alive.
  return 0;
}
