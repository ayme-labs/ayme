import { dirname, join } from "node:path";
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

/**
 * Runs `ayme capture <url>`, or `ayme capture --cdp=<url>` when given the
 * running browser's address, to its end. Resolves with the process's
 * exit code. What it prints and which code it gives are decided above; this
 * is the wiring to the terminal's signals and streams.
 */
export async function capture(target: CaptureTarget): Promise<number> {
  const browser = browserOf(target, process.env);
  const recorder = await start(browser);
  if (!recorder) return 1;

  // The terminal's stop ends the recorder. Another one lands here again and
  // does no harm.
  const end = () => recorder.end();
  process.on("SIGINT", end);
  process.on("SIGTERM", end);
  process.stdout.write(startLines(browser, recorder.windowUrl));
  const printWarnings = warningPrinter((text) => process.stderr.write(text));
  recorder.subscribe((update) => printWarnings(update.state.warnings));

  const { stream, text, code } = outcomeReport(await recorder.done);
  process[stream].write(text);
  return code;
}
