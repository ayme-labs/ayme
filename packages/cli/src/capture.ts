import type { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  RecorderStartError,
  startRecorder,
  type Recorder,
  type RecorderOptions,
  type RecorderWarning,
  type RecordingOutcome,
} from "@ayme-dev/recorder";

import type { CaptureTarget } from "./readCommand";

/**
 * How `ayme capture <url>` opens the browser: with a window by default, and
 * without one for `--headless`; `--start-recording` opens it already
 * recording. The two environment variables are for the tests: they run where
 * there is no screen, so one of them opens the browser without a window too,
 * and they act in the recorded browser over a connection of their own.
 */
export function launchOptions(
  url: string,
  env: NodeJS.ProcessEnv,
  headless?: boolean,
  startRecording?: true
): Extract<RecorderOptions["browser"], { launch: unknown }>["launch"] {
  const debugPort = env.AYME_RECORDER_DEBUG_PORT;
  return {
    url,
    headless: headless ?? env.AYME_RECORDER_HEADLESS === "1",
    ...(debugPort ? { debugPort: Number(debugPort) } : {}),
    ...(startRecording ? { startRecording } : {}),
  };
}

export function browserOf(
  target: CaptureTarget,
  env: NodeJS.ProcessEnv
): RecorderOptions["browser"] {
  return "url" in target
    ? {
        launch: {
          ...launchOptions(
            target.url,
            env,
            target.headless,
            target.startRecording
          ),
          // Playwright's codegen files: the recorder opens the context, so it
          // loads and saves them itself.
          ...(target.loadStorage !== undefined
            ? { loadStorage: target.loadStorage }
            : {}),
          ...(target.saveStorage !== undefined
            ? { saveStorage: target.saveStorage }
            : {}),
        },
      }
    : { attach: { cdpEndpoint: target.cdp } };
}

export function startLine(browser: RecorderOptions["browser"]): string {
  return "attach" in browser
    ? `Attached to the browser at ${browser.attach.cdpEndpoint}. Close its page, or press Ctrl+C here, to end: the browser stays open.\n`
    : `Opened ${browser.launch.url}. Close the browser, or press Ctrl+C here, to end.\n`;
}

export function windowLine(url: string): string {
  return `Recorder UI: ${url}\n`;
}

export function startLines(
  browser: RecorderOptions["browser"],
  windowUrl: string | null | undefined
): string {
  return startLine(browser) + (windowUrl ? windowLine(windowUrl) : "");
}

/**
 * The folder of the recorder window's built files: the build puts them in a
 * `window` folder beside the command's own file, so that the packed package
 * carries the window and needs nothing resolved where it is installed.
 */
export const windowFolder = (commandFile: string): string =>
  join(dirname(fileURLToPath(commandFile)), "window");

/** The in-page toolbar's built script, which the build puts in a `toolbar`
 * folder beside the command's own file, as it does the window. */
export const toolbarScript = (commandFile: string): string =>
  join(dirname(fileURLToPath(commandFile)), "toolbar", "toolbar.js");

export function outcomeLine(outcome: RecordingOutcome): string {
  switch (outcome.kind) {
    case "saved":
      return `Recording package: ${join(outcome.folder, "package.yaml")}\n`;
    case "empty":
      return "Recording was empty; no recording package was created.\n";
    case "failed":
      return `The recorder failed: ${outcome.reason}\n`;
  }
}

/**
 * Writes each warning the recorder tells of once, as it comes: the state
 * carries every warning so far, and only the new ones are written.
 */
export function warningPrinter(
  write: (text: string) => void
): (warnings: readonly RecorderWarning[]) => void {
  let printed = 0;
  return (warnings) => {
    for (const warning of warnings.slice(printed))
      write(`Warning: ${warning.message}\n`);
    printed = Math.max(printed, warnings.length);
  };
}

export const exitCode = (outcome: RecordingOutcome): number =>
  outcome.kind === "failed" ? 1 : 0;

export function outcomeReport(outcome: RecordingOutcome): {
  stream: "stdout" | "stderr";
  text: string;
  code: number;
} {
  return {
    stream: outcome.kind === "failed" ? "stderr" : "stdout",
    text: outcomeLine(outcome),
    code: exitCode(outcome),
  };
}

/** What a person is told of an error that stopped the recorder from starting:
 * its own sentence, with no stack trace, and Playwright's own command that
 * installs Chromium when a browser it was to open could not be. Nothing for
 * any other error, which is not theirs to read. */
export function startFailure(
  error: unknown,
  browser: RecorderOptions["browser"]
): string | undefined {
  if (!(error instanceof RecorderStartError)) return undefined;
  const install =
    error.reason === "browser-unavailable" && "launch" in browser
      ? "If Chromium is not installed for the project's Playwright, install it with: npx playwright install chromium\n"
      : "";
  return `${error.message}\n${install}`;
}

/** Starts the recorder in the project the command was started in. A start
 * error is printed and gives no recorder. */
async function start(
  browser: RecorderOptions["browser"]
): Promise<Recorder | undefined> {
  try {
    return await startRecorder({
      projectDir: process.cwd(),
      browser,
      window: { folder: windowFolder(import.meta.url) },
      toolbar: { script: toolbarScript(import.meta.url) },
    });
  } catch (error) {
    const told = startFailure(error, browser);
    if (told === undefined) throw error;
    process.stderr.write(told);
    return undefined;
  }
}

/** The signals that end a run with a save: Ctrl+C, a kill, and the terminal
 * closing, as a window, a tab or an SSH session does. */
const ENDING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** The errors nothing caught, which would otherwise end the process at once,
 * with nothing saved. */
const UNCAUGHT = ["uncaughtException", "unhandledRejection"] as const;

/** What an error nothing caught is, as a line can show it. Anything can be
 * thrown, also a value no text can be made of. */
function shown(cause: unknown): string {
  try {
    // Made text here, where a throw is caught: a stack can be any value.
    return `${cause instanceof Error ? (cause.stack ?? cause.message) : cause}`;
  } catch {
    return "an error that cannot be shown";
  }
}

/**
 * Runs a started recorder to its end, wired to the terminal. Resolves with
 * the process's exit code: the outcome's, or 1 after an error nothing
 * caught, which ends the recorder as Ctrl+C does, with a save.
 */
export async function runUntilEnd(
  recorder: Pick<Recorder, "end" | "done" | "subscribe" | "windowUrl">,
  browser: RecorderOptions["browser"],
  terminal: EventEmitter & {
    readonly stdout: Writable;
    readonly stderr: Writable;
  }
): Promise<number> {
  // Never removed: a failed write, as to a closed terminal, reports its error after the write, even after this returns, and that error would crash the process after a good save.
  terminal.stdout.on("error", () => {});
  terminal.stderr.on("error", () => {});
  const write = (stream: "stdout" | "stderr", text: string) =>
    void terminal[stream].write(text);

  // Another stop lands here again and does no harm.
  const end = () => recorder.end();
  let broke = false;
  const unexpected = (cause?: unknown) => {
    // The save first, once: an error the save itself throws only adds its line.
    if (!broke) {
      broke = true;
      end();
    }
    write(
      "stderr",
      `The recorder hit an error it did not expect, and ends with what it has recorded: ${shown(cause)}\n`
    );
  };
  for (const signal of ENDING_SIGNALS) terminal.on(signal, end);
  for (const event of UNCAUGHT) terminal.on(event, unexpected);
  try {
    write("stdout", startLines(browser, recorder.windowUrl));
    const printWarnings = warningPrinter((text) => write("stderr", text));
    recorder.subscribe((update) => printWarnings(update.state.warnings));

    const { stream, text, code } = outcomeReport(await recorder.done);
    write(stream, text);
    return broke ? 1 : code;
  } finally {
    // An error after the end is the process's own again.
    for (const signal of ENDING_SIGNALS) terminal.off(signal, end);
    for (const event of UNCAUGHT) terminal.off(event, unexpected);
  }
}

/**
 * Runs `ayme capture <url>`, or `ayme capture --cdp=<url>` when given the
 * running browser's address, to its end. Resolves with the process's
 * exit code.
 */
export async function capture(target: CaptureTarget): Promise<number> {
  const browser = browserOf(target, process.env);
  const recorder = await start(browser);
  if (!recorder) return 1;
  return runUntilEnd(recorder, browser, process);
}
