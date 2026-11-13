import { join } from "node:path";
import {
  RecorderStartError,
  startRecorder,
  type Recorder,
  type RecorderOptions,
  type RecordingOutcome,
} from "@ayme-dev/recorder";

/**
 * How `codegen <url>` launches the browser. The two environment variables
 * are for the tests: they run where there is no screen, and act in the
 * recorded browser over a connection of their own.
 */
export function launchOptions(
  url: string,
  env: NodeJS.ProcessEnv
): RecorderOptions["browser"]["launch"] {
  const debugPort = env.AYME_RECORDER_DEBUG_PORT;
  return {
    url,
    headless: env.AYME_RECORDER_HEADLESS === "1",
    ...(debugPort ? { debugPort: Number(debugPort) } : {}),
  };
}

/** What the terminal is told when the recorder has ended. */
export function outcomeLine(outcome: RecordingOutcome): string {
  return outcome.kind === "saved"
    ? `Recording package: ${join(outcome.folder, "package.yaml")}\n`
    : "Nothing was recorded.\n";
}

/** Starts the recorder in the project the command was started in. A start
 * error is printed and gives no recorder. */
async function start(url: string): Promise<Recorder | undefined> {
  try {
    return await startRecorder({
      projectDir: process.cwd(),
      browser: { launch: launchOptions(url, process.env) },
    });
  } catch (error) {
    if (!(error instanceof RecorderStartError)) throw error;
    // Its message is a sentence for the terminal: no stack trace.
    process.stderr.write(`${error.message}\n`);
    return undefined;
  }
}

/** Runs `codegen <url>` to its end. Resolves with the process's exit code. */
export async function codegen(url: string): Promise<number> {
  const recorder = await start(url);
  if (!recorder) return 1;

  // The terminal's stop ends the recorder. Another one lands here again and
  // does no harm.
  const end = () => recorder.end();
  process.on("SIGINT", end);
  process.on("SIGTERM", end);
  process.stdout.write(
    `Opened ${url}. Close the browser, or press Ctrl+C here, to end.\n`
  );

  const outcome = await recorder.done;
  process.stdout.write(outcomeLine(outcome));
  return 0;
}
