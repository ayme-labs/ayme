// Where a Session's process says how to reach it, in a cache folder of the
// user's, as Playwright CLI keeps its session files. Each start of a Session
// in a project folder claims the next generation of the folder's records:
// a claim is the creation of a file no other claim can create, so two
// starts never both win, and a record whose Session is gone is never
// removed to make room.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** What the process of a Session is known by while it runs. */
export type SessionRecord = {
  readonly pid: number;
  /** When the process started, as the system tells it: with `pid`, it
   * tells the process from a later one that was given the same pid. */
  readonly since: string;
  /** The local socket it listens on. */
  readonly socket: string;
};

/** The newest claim of a folder: generation 0 when there is none. */
export type Claim = {
  readonly generation: number;
  readonly record?: SessionRecord;
  readonly live: boolean;
};

// Only the user may read or change what a Session keeps.
const PRIVATE_FOLDER = 0o700;
const PRIVATE_FILE = 0o600;

function cacheFolder(): string {
  const { AYME_CACHE_DIR, XDG_CACHE_HOME } = process.env;
  if (AYME_CACHE_DIR) return AYME_CACHE_DIR;
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Caches", "ayme");
  return join(XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ayme");
}

/** The folder of the claims of a project folder's Session, named by a hash
 * of the project folder's real path: what a claim is keyed by. */
const claimFolder = (projectDir: string) =>
  join(
    cacheFolder(),
    "sessions",
    createHash("sha1")
      .update(realpathSync(projectDir))
      .digest("hex")
      .slice(0, 16)
  );

const recordFile = (folder: string, generation: number) =>
  join(folder, `${generation}.json`);
const endedFile = (folder: string, generation: number) =>
  join(folder, `${generation}.ended`);

/** When the process `pid` started, or undefined when there is none. */
export function processStart(pid: number): string | undefined {
  try {
    if (process.platform === "linux") {
      // The 22nd field, counted after the name, which may hold spaces.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    }
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return started || undefined;
  } catch {
    return undefined;
  }
}

/** This process, as a record names it. */
export const thisProcess = (): Omit<SessionRecord, "socket"> => ({
  pid: process.pid,
  since: processStart(process.pid)!,
});

function readRecord(file: string): SessionRecord | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
  } catch {
    return undefined;
  }
}

const generations = (folder: string): number[] => {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const found = /^(\d+)\.json$/.exec(name);
    return found ? [Number(found[1])] : [];
  });
};

/** The newest claim of the folder of `projectDir`'s Session. It is live
 * while its process runs and its Session has not ended. */
export function readClaim(projectDir: string): Claim {
  const folder = claimFolder(projectDir);
  const generation = Math.max(0, ...generations(folder));
  if (generation === 0) return { generation, live: false };
  const record = readRecord(recordFile(folder, generation));
  const live =
    record !== undefined &&
    processStart(record.pid) === record.since &&
    !existsSync(endedFile(folder, generation));
  return record ? { generation, record, live } : { generation, live };
}

/** The record of the folder's Session, while it is live. */
export function liveRecord(
  projectDir: string
): (SessionRecord & { readonly generation: number }) | undefined {
  const { generation, record, live } = readClaim(projectDir);
  return live && record ? { ...record, generation } : undefined;
}

/**
 * Claims the generation after `seen`, a claim of the folder that is not
 * live, for `record`, and resolves with it; undefined when another claim got
 * there first. A claim made from an older read can create a generation that
 * a later claim already passed and cleared: it then finds a newer one and
 * gives its own up.
 */
export function claimAfter(
  projectDir: string,
  seen: Claim,
  record: SessionRecord
): number | undefined {
  const folder = claimFolder(projectDir);
  mkdirSync(folder, { recursive: true, mode: PRIVATE_FOLDER });
  const generation = seen.generation + 1;
  const written = join(folder, `${randomUUID()}.tmp`);
  writeFileSync(written, JSON.stringify(record), {
    mode: PRIVATE_FILE,
    flag: "wx",
  });
  try {
    linkSync(written, recordFile(folder, generation));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  } finally {
    rmSync(written, { force: true });
  }
  const all = generations(folder);
  if (all.some((other) => other > generation)) {
    rmSync(recordFile(folder, generation), { force: true });
    return undefined;
  }
  // The generations before this one are over for good.
  for (const old of all.filter((other) => other < generation)) {
    rmSync(recordFile(folder, old), { force: true });
    rmSync(endedFile(folder, old), { force: true });
  }
  return generation;
}

/**
 * Makes `record` the folder's, unless the folder has a live Session: then
 * that Session's record is returned.
 */
export function claimRecord(
  projectDir: string,
  record: SessionRecord
): { readonly generation: number } | { readonly holder: SessionRecord } {
  for (;;) {
    const seen = readClaim(projectDir);
    if (seen.live && seen.record) return { holder: seen.record };
    const generation = claimAfter(projectDir, seen, record);
    if (generation !== undefined) return { generation };
  }
}

/** Says that the Session of the folder's claim `generation` ended: from
 * then on the folder has no Session of it. */
export function releaseRecord(projectDir: string, generation: number): void {
  try {
    writeFileSync(endedFile(claimFolder(projectDir), generation), "", {
      mode: PRIVATE_FILE,
      flag: "wx",
    });
  } catch {
    // Already said, or a later claim cleared the generation.
  }
}

/** Why a Session cannot start in a folder whose Session `holder` keeps. */
export const alreadyOpen = (
  projectDir: string,
  holder: SessionRecord
): string =>
  `A Session is already open in ${projectDir}, in process ${holder.pid}. End it with ayme close first.`;

/** A folder of one Session's own, which only the user can enter: its socket
 * and the log of its process. It is in the system's temporary folder, whose
 * path is short enough for a local socket, which one in the cache folder is
 * not always. */
export function privateFolder(): {
  readonly folder: string;
  readonly socket: string;
  readonly log: string;
} {
  // mkdtemp makes the folder with no access for anyone but the user.
  const folder = mkdtempSync(join(tmpdir(), "ayme-"));
  return {
    folder,
    socket: join(folder, "session.sock"),
    log: join(folder, "session.log"),
  };
}
