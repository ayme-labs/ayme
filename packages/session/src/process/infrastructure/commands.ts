// The commands' side of a Session's process: each command finds the
// process of its folder, sends one request and returns its answer.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  failed,
  type SessionAnswer,
  type SessionRequest,
} from "../../session/domain";
import type { SessionProcessOptions } from "./background";
import { alreadyOpen, liveRecord, logFile } from "./record";
import { send } from "./wire";

const noSession = (projectDir: string) =>
  failed(`No Session is open in ${projectDir}. Start one with ayme open.`);

/** Sends `request` to the Session of `projectDir`. */
export async function askSession(
  projectDir: string,
  request: SessionRequest
): Promise<SessionAnswer> {
  const record = liveRecord(projectDir);
  if (!record) return noSession(projectDir);
  try {
    return await send(record.socket, request);
  } catch (error) {
    return failed(
      `The Session's process (${record.pid}) did not answer: ${(error as Error).message}`
    );
  }
}

/** How a command starts a Session's background process: the command line
 * before its options, run with this Node. */
export type OpenOptions = SessionProcessOptions & {
  readonly processCommand: readonly string[];
};

/**
 * Starts a Session in a background process of its own, and resolves with
 * the answer to its start once the start succeeded or failed.
 */
export async function openSession({
  processCommand,
  ...options
}: OpenOptions): Promise<SessionAnswer> {
  // Also refused by the process itself, which claims the folder: refused
  // here, the process of the folder's Session keeps its log.
  const holder = liveRecord(options.projectDir);
  if (holder) return failed(alreadyOpen(options.projectDir, holder));
  const log = logFile(options.projectDir);
  mkdirSync(dirname(log), { recursive: true });
  const output = openSync(log, "w");
  const child = spawn(
    process.execPath,
    [...processCommand, JSON.stringify(options)],
    {
      cwd: options.projectDir,
      detached: true,
      stdio: ["ignore", output, output],
    }
  );
  closeSync(output);
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  );
  let gone = false;
  void exited.then(() => (gone = true));
  for (;;) {
    if (gone)
      return failed(
        readFileSync(log, "utf8").trim() ||
          "The Session's process ended before the Session started."
      );
    const record = liveRecord(options.projectDir);
    if (record !== undefined && record.pid === child.pid) {
      const answer = await send(record.socket, { started: {} }).catch(
        (error: Error) =>
          failed(`The Session's process did not answer: ${error.message}`)
      );
      // A Session that did not start is gone once its process is: a new
      // start in the folder is not refused by it.
      if (!answer.ok) await exited;
      else child.unref();
      return answer;
    }
    await sleep(25);
  }
}
