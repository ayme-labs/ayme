import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  passThroughTraceTool,
  projectPlaywrightCli,
} from "../playwright/infrastructure";
import { findTrace } from "../timeline/infrastructure";

/** What `trace` comes to: the arguments for the stock tool, or why not. */
export type TraceInvocation =
  | { readonly kind: "run"; readonly args: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

const RECORDING_ID = /^rec_[A-Za-z0-9_-]+$/;
const isRecording = (target: string) =>
  target === "latest" || RECORDING_ID.test(target);

/**
 * What `trace <arguments>` asks of the project's own `playwright trace`.
 * `latest`, a recording's id or a trace file opens that trace, as the stock
 * tool's `open` does, and `open` takes `latest` or an id in the file's
 * place. Anything else is the stock tool's own command, passed on as it is.
 */
export async function traceInvocation(
  projectDir: string,
  args: readonly string[]
): Promise<TraceInvocation> {
  const [first, second] = args;
  const opened = (target: string, more: readonly string[]) =>
    isRecording(target)
      ? openRecording(projectDir, target, more)
      : Promise.resolve<TraceInvocation>({ kind: "run", args });
  if (first === "open") return opened(second ?? "latest", args.slice(2));
  if (isRecording(first))
    return openRecording(projectDir, first, args.slice(1));
  if (first !== undefined && !first.startsWith("-")) {
    const file = resolve(projectDir, first);
    if ((await stat(file).catch(() => undefined))?.isFile())
      return { kind: "run", args: ["open", file, ...args.slice(1)] };
  }
  return { kind: "run", args };
}

async function openRecording(
  projectDir: string,
  recording: string,
  more: readonly string[]
): Promise<TraceInvocation> {
  const found = await findTrace(projectDir, recording);
  return found.kind === "found"
    ? { kind: "run", args: ["open", found.file, ...more] }
    : { kind: "error", message: found.reason };
}

/**
 * Runs `trace <arguments>` on the project's own Playwright, in the project's
 * folder, with the terminal as its own. Resolves with the exit code.
 */
export async function runTrace(options: {
  readonly projectDir: string;
  readonly args: readonly string[];
}): Promise<number> {
  const cli = projectPlaywrightCli(options.projectDir);
  if (!cli) {
    process.stderr.write(
      `No Playwright is installed in ${options.projectDir}. The trace tool is the project's own: install Playwright there, for example with "npm install -D @playwright/test".\n`
    );
    return 1;
  }
  const invocation = await traceInvocation(options.projectDir, options.args);
  if (invocation.kind === "error") {
    process.stderr.write(`${invocation.message}\n`);
    return 1;
  }
  return passThroughTraceTool(cli, invocation.args, options.projectDir);
}
