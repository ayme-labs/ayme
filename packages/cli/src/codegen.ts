import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  RecorderStartError,
  startRecorder,
  type Recorder,
  type RecorderOptions,
  type RecordingOutcome,
} from "@ayme-dev/recorder";

/**
 * How `codegen <url>` launches the browser. `--headless` and `--headed` say
 * whether it has a window. The two environment variables are for the tests:
 * they run where there is no screen, and act in the recorded browser over a
 * connection of their own. The command line wins over them.
 */
export function launchOptions(
  url: string,
  env: NodeJS.ProcessEnv,
  headless?: boolean
): Extract<RecorderOptions["browser"], { launch: unknown }>["launch"] {
  const debugPort = env.AYME_RECORDER_DEBUG_PORT;
  return {
    url,
    headless: headless ?? env.AYME_RECORDER_HEADLESS === "1",
    ...(debugPort ? { debugPort: Number(debugPort) } : {}),
  };
}

/** What the terminal is told once the recorder has started. */
export function startLine(browser: RecorderOptions["browser"]): string {
  return "attach" in browser
    ? `Attached to the browser at ${browser.attach.cdpEndpoint}. Close its page, or press Ctrl+C here, to end: the browser stays open.\n`
    : `Opened ${browser.launch.url}. Close the browser, or press Ctrl+C here, to end.\n`;
}

/** What the terminal is told of the recorder window: its address. */
export function windowLine(url: string): string {
  return `Recorder window: ${url}\n`;
}

/** The folder of the recorder window's built files: the CLI is what knows
 * both the engine and the window, and hands the one the other. */
const windowFolder = () =>
  dirname(
    createRequire(import.meta.url).resolve(
      "@ayme-dev/recorder-window/window/index.html"
    )
  );

/** What the terminal is told when the recorder has ended. */
export function outcomeLine(outcome: RecordingOutcome): string {
  switch (outcome.kind) {
    case "saved":
      return `Recording package: ${join(outcome.folder, "package.yaml")}\n`;
    case "empty":
      return "Nothing was recorded.\n";
    case "failed":
      return `The recorder failed: ${outcome.reason}\n`;
  }
}

/** The process's exit code for an outcome. */
export const exitCode = (outcome: RecordingOutcome): number =>
  outcome.kind === "failed" ? 1 : 0;

/** Starts the recorder in the project the command was started in. A start
 * error is printed and gives no recorder. */
async function start(
  browser: RecorderOptions["browser"]
): Promise<Recorder | undefined> {
  try {
    return await startRecorder({
      projectDir: process.cwd(),
      browser,
      window: { folder: windowFolder() },
    });
  } catch (error) {
    if (!(error instanceof RecorderStartError)) throw error;
    // Its message is a sentence for the terminal: no stack trace.
    process.stderr.write(`${error.message}\n`);
    return undefined;
  }
}

/**
 * Runs `codegen <url>`, or `codegen --cdp-endpoint <address>` when given
 * the running browser's address, to its end. Resolves with the process's
 * exit code.
 */
export async function codegen(
  target:
    | { readonly url: string; readonly headless?: boolean }
    | { readonly cdpEndpoint: string }
): Promise<number> {
  const browser: RecorderOptions["browser"] =
    "url" in target
      ? { launch: launchOptions(target.url, process.env, target.headless) }
      : { attach: { cdpEndpoint: target.cdpEndpoint } };
  const recorder = await start(browser);
  if (!recorder) return 1;

  // The terminal's stop ends the recorder. Another one lands here again and
  // does no harm.
  const end = () => recorder.end();
  process.on("SIGINT", end);
  process.on("SIGTERM", end);
  process.stdout.write(startLine(browser));
  if (recorder.windowUrl) process.stdout.write(windowLine(recorder.windowUrl));

  const outcome = await recorder.done;
  (outcome.kind === "failed" ? process.stderr : process.stdout).write(
    outcomeLine(outcome)
  );
  return exitCode(outcome);
}
