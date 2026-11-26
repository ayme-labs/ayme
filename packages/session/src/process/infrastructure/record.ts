// Where a Session's process says how to reach it: one record per project
// folder, in a cache folder of the user's, as Playwright CLI keeps its
// session files.
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** What a Session's process writes once it listens. */
export type SessionRecord = {
  readonly pid: number;
  /** The local socket it listens on. */
  readonly socket: string;
};

function cacheFolder(): string {
  const { AYME_CACHE_DIR, XDG_CACHE_HOME } = process.env;
  if (AYME_CACHE_DIR) return AYME_CACHE_DIR;
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Caches", "ayme");
  return join(XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ayme");
}

/** The folder's name in the cache: a hash of its real path. */
const keyOf = (projectDir: string) =>
  createHash("sha1")
    .update(realpathSync(projectDir))
    .digest("hex")
    .slice(0, 16);

const recordFile = (projectDir: string) =>
  join(cacheFolder(), "sessions", `${keyOf(projectDir)}.json`);

/** Where the process of a folder's Session writes what it prints. */
export const logFile = (projectDir: string): string =>
  join(cacheFolder(), "sessions", `${keyOf(projectDir)}.log`);

/** A socket path short enough for a Unix socket, which one in the cache
 * folder is not always. */
export const socketFile = (projectDir: string, pid: number): string =>
  join(tmpdir(), `ayme-${keyOf(projectDir)}-${pid}.sock`);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The record of the folder's Session, when its process is alive. A record
 * whose process is gone is removed. */
export function liveRecord(projectDir: string): SessionRecord | undefined {
  const file = recordFile(projectDir);
  let record: SessionRecord;
  try {
    record = JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
  } catch {
    return undefined;
  }
  if (isAlive(record.pid)) return record;
  rmSync(file, { force: true });
  return undefined;
}

/**
 * Makes `record` the folder's, unless a live Session has one: then that
 * record is returned. The record appears whole and at most once, as a link
 * to a file already written, so two Sessions starting at the same moment
 * cannot both claim the folder.
 */
export function claimRecord(
  projectDir: string,
  record: SessionRecord
): SessionRecord | undefined {
  const file = recordFile(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  const written = `${file}.${record.pid}`;
  writeFileSync(written, JSON.stringify(record));
  try {
    for (;;) {
      try {
        linkSync(written, file);
        return undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = liveRecord(projectDir);
      if (holder) return holder;
    }
  } finally {
    rmSync(written, { force: true });
  }
}

/** Why a Session cannot start in a folder whose Session `holder` keeps. */
export const alreadyOpen = (
  projectDir: string,
  holder: SessionRecord
): string =>
  `A Session is already open in ${projectDir}, in process ${holder.pid}. End it with ayme close first.`;

/** Removes the folder's record if it is `pid`'s. */
export function releaseRecord(projectDir: string, pid: number): void {
  if (liveRecord(projectDir)?.pid === pid)
    rmSync(recordFile(projectDir), { force: true });
}
