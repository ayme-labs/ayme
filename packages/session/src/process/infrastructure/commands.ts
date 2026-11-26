// The commands' side of a Session's process: each command finds the
// process of its folder, sends one request and returns its answer.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import type { SessionBrowserRequest } from "../../session/application";
import {
  failed,
  type SessionAnswer,
  type SessionRequest,
} from "../../session/domain";
import type { FromOpener } from "./background";
import {
  alreadyOpen,
  claimRecord,
  liveRecord,
  privateFolder,
  processStart,
} from "./record";
import { send } from "./wire";

const noSession = (projectDir: string) =>
  failed(`No Session is open in ${projectDir}. Start one with ayme open.`);

/** Whether `error` says nobody listens on the socket yet. */
const notListening = (error: unknown) =>
  ["ENOENT", "ECONNREFUSED"].includes(
    (error as NodeJS.ErrnoException).code ?? ""
  );

/** Sends `request` to the Session of `projectDir`. A Session still
 * starting is waited for, as long as its process runs (rule 10). */
export async function askSession(
  projectDir: string,
  request: SessionRequest
): Promise<SessionAnswer> {
  for (;;) {
    const record = liveRecord(projectDir);
    if (!record) return noSession(projectDir);
    try {
      return await send(record.socket, request);
    } catch (error) {
      if (!notListening(error))
        return failed(
          `The Session's process (${record.pid}) did not answer: ${(error as Error).message}`
        );
    }
    await sleep(25);
  }
}

/** The text the process of a start printed before it ended. */
function printed(log: string): string {
  try {
    return readFileSync(log, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * How a start ends, as its process tells it: the process is spawned, the
 * folder claimed for it, and it answers the start over its IPC channel.
 * A process that fails to spawn, or ends before it answers, is answered
 * with why.
 */
function startOf(
  child: ChildProcess,
  projectDir: string,
  socket: string,
  log: string
): Promise<SessionAnswer> {
  return new Promise((resolve) => {
    child.once("error", (error) =>
      resolve(failed(`The Session's process could not start: ${error.message}`))
    );
    child.once("spawn", () => {
      const pid = child.pid!;
      const since = processStart(pid);
      // A process already gone is answered by its exit.
      if (since === undefined) return;
      const claim = claimRecord(projectDir, { pid, since, socket });
      if ("holder" in claim) {
        child.kill();
        return resolve(failed(alreadyOpen(projectDir, claim.holder)));
      }
      child.send({ claimed: claim.generation } satisfies FromOpener);
    });
    // A Session that did not start is gone once its process is: a new
    // start in the folder is not refused by it.
    let told: SessionAnswer | undefined;
    child.once("message", (answer: SessionAnswer) => {
      told = answer;
      if (answer.ok) resolve(answer);
    });
    child.once("exit", () =>
      resolve(
        told ??
          failed(
            printed(log) ||
              "The Session's process ended before the Session started."
          )
      )
    );
  });
}

/**
 * Starts a Session in a background process of its own, and resolves with
 * the answer to its start once the start succeeded or failed.
 * `processCommand` is the command line of that process before its options,
 * run with this Node.
 */
export async function openSession({
  projectDir,
  request,
  processCommand,
}: {
  readonly projectDir: string;
  readonly request: SessionBrowserRequest;
  readonly processCommand: readonly string[];
}): Promise<SessionAnswer> {
  // Also refused by the claim: refused here, no process starts.
  const holder = liveRecord(projectDir);
  if (holder) return failed(alreadyOpen(projectDir, holder));
  const { folder, socket, log } = privateFolder();
  const output = openSync(log, "w", 0o600);
  const child = spawn(
    process.execPath,
    [...processCommand, JSON.stringify({ projectDir, request, socket })],
    {
      cwd: projectDir,
      detached: true,
      stdio: ["ignore", output, output, "ipc"],
    }
  );
  closeSync(output);
  const answer = await startOf(child, projectDir, socket, log);
  if (answer.ok) {
    if (child.connected) child.disconnect();
    child.unref();
  } else rmSync(folder, { recursive: true, force: true });
  return answer;
}
