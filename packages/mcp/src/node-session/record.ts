// Spike: where a background process says how to reach it. One record per
// project folder, in a cache folder of the user's, as Playwright CLI keeps
// its session files. Node built-ins only: every thin command loads this.
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** What a background process writes once it listens. */
export type SessionRecord = {
  /** The project folder it was started in. */
  folder: string;
  /** The local socket it listens on. */
  socket: string;
  pid: number;
  /** The `@ayme-dev/mcp` version of the process. */
  version: string;
  /** The CDP endpoint it attached to. */
  endpoint: string;
  /** The URL of the tab it took, when it took it. */
  url: string;
  startedAt: string;
};

function cacheFolder(): string {
  if (process.env.AYME_CACHE_DIR) return process.env.AYME_CACHE_DIR;
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Caches", "ayme");
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ayme");
}

/** The folder's name in the cache: a hash of its real path. */
export const keyOf = (folder: string) =>
  createHash("sha1").update(realpathSync(folder)).digest("hex").slice(0, 16);

export const recordFile = (folder: string) =>
  join(cacheFolder(), "sessions", `${keyOf(folder)}.json`);

/** Where the background process of `folder` writes what it logs. */
export const logFile = (folder: string) =>
  join(cacheFolder(), "sessions", `${keyOf(folder)}.log`);

/** A socket path short enough for a Unix socket, which the cache folder's is not always. */
export const socketFile = (folder: string, pid: number) =>
  join(tmpdir(), `ayme-${keyOf(folder)}-${pid}.sock`);

export function readRecord(folder: string): SessionRecord | undefined {
  try {
    return JSON.parse(
      readFileSync(recordFile(folder), "utf8")
    ) as SessionRecord;
  } catch {
    return undefined;
  }
}

export function writeRecord(record: SessionRecord): void {
  const file = recordFile(record.folder);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

export function removeRecord(folder: string): void {
  rmSync(recordFile(folder), { force: true });
}

/** Whether a process with `pid` exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
