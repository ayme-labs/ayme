// Where a Session's process says how to reach it, in a cache folder of the
// user's, as Playwright CLI keeps its session files. A project folder can
// have several Sessions, each with a name. Each start of a Session of a name
// claims the next generation of that name's records in the folder:
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

import { commandLine } from "../../session/domain";

/** Which Session of which project folder: one name of the folder's, the
 * default name when none is given. */
export type SessionPlace = {
  readonly projectDir: string;
  readonly name?: string | undefined;
};

/** The name of a Session started or reached without one, as Playwright
 * CLI's. */
const DEFAULT_NAME = "default";

/** The name of `place`'s Session. */
export const nameOf = ({ name }: SessionPlace): string => name ?? DEFAULT_NAME;

// A name is shown in hints such as `ayme -s=<name> close`, which a shell
// must read as one word.
const USABLE_NAME = /^[\w.-]+$/;
// Its claim folder's name holds it twice over, and a file name has at most
// 255 bytes.
const LONGEST_NAME = 64;

/** Why `place`'s name cannot name a Session, if it cannot. */
export function unusableName(place: SessionPlace): string | undefined {
  const name = nameOf(place);
  if (!USABLE_NAME.test(name))
    return `${JSON.stringify(name)} cannot name a Session: a name has letters, digits, ".", "_" and "-" only.`;
  if (name.length > LONGEST_NAME)
    return `${JSON.stringify(name)} cannot name a Session: a name has at most ${LONGEST_NAME} characters.`;
  return undefined;
}

/** What the process of a Session is known by while it runs. */
export type SessionRecord = {
  /** The Session's name in its project folder. */
  readonly name: string;
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
  /** Whether its Session's start succeeded. */
  readonly started: boolean;
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

const hash = (text: string) =>
  createHash("sha1").update(text).digest("hex").slice(0, 16);

const sessionsFolder = () => join(cacheFolder(), "sessions");

/** What the claim folders of a project folder's Sessions start with: a
 * hash of the project folder's real path. */
const folderKey = (projectDir: string) => `${hash(realpathSync(projectDir))}-`;

/** The folder of the claims of a Session of a project folder, named by
 * the project folder's key and the Session's name in hexadecimal: what a
 * claim is keyed by. Hexadecimal keeps two names apart exactly, also those
 * that differ only in case on a file system that ignores it. */
const claimFolder = (place: SessionPlace) =>
  join(
    sessionsFolder(),
    folderKey(place.projectDir) + Buffer.from(nameOf(place)).toString("hex")
  );

const recordFile = (folder: string, generation: number) =>
  join(folder, `${generation}.json`);
const endedFile = (folder: string, generation: number) =>
  join(folder, `${generation}.ended`);
const startedFile = (folder: string, generation: number) =>
  join(folder, `${generation}.started`);

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
export const thisProcess = (): Omit<SessionRecord, "socket" | "name"> => ({
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

/** The newest claim of `place`'s Session. It is live while its process
 * runs and its Session has not ended. */
export function readClaim(place: SessionPlace): Claim {
  return readClaimIn(claimFolder(place));
}

function readClaimIn(folder: string): Claim {
  const generation = Math.max(0, ...generations(folder));
  if (generation === 0) return { generation, live: false, started: false };
  const record = readRecord(recordFile(folder, generation));
  // The end marker first: an ended claim needs no look at its process.
  const live =
    record !== undefined &&
    !existsSync(endedFile(folder, generation)) &&
    processStart(record.pid) === record.since;
  const started = existsSync(startedFile(folder, generation));
  return record
    ? { generation, record, live, started }
    : { generation, live, started };
}

/** The record of `place`'s Session, while it is live. */
export function liveRecord(
  place: SessionPlace
): (SessionRecord & { readonly generation: number }) | undefined {
  const { generation, record, live } = readClaim(place);
  return live && record ? { ...record, generation } : undefined;
}

/** The records of the live Sessions of a project folder, by name, each
 * with whether its start is still under way. */
export function liveRecords(
  projectDir: string
): readonly (SessionRecord & { readonly starting: boolean })[] {
  const key = folderKey(projectDir);
  let names: string[];
  try {
    names = readdirSync(sessionsFolder());
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(key))
    .flatMap((name) => {
      const { record, live, started } = readClaimIn(
        join(sessionsFolder(), name)
      );
      return live && record ? [{ ...record, starting: !started }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Claims the generation after `seen`, a claim of the folder that is not
 * live, for `record`, and resolves with it; undefined when another claim got
 * there first. A claim made from an older read can create a generation that
 * a later claim already passed and cleared: it then finds a newer one and
 * gives its own up.
 */
export function claimAfter(
  place: SessionPlace,
  seen: Claim,
  owner: Omit<SessionRecord, "name">
): number | undefined {
  const folder = claimFolder(place);
  const record: SessionRecord = { name: nameOf(place), ...owner };
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
    rmSync(startedFile(folder, old), { force: true });
  }
  return generation;
}

/**
 * Makes `place`'s Session the one of `owner`, unless a live Session has
 * its name: then that Session's record is returned.
 */
export function claimRecord(
  place: SessionPlace,
  owner: Omit<SessionRecord, "name">
): { readonly generation: number } | { readonly holder: SessionRecord } {
  for (;;) {
    const seen = readClaim(place);
    if (seen.live && seen.record) return { holder: seen.record };
    const generation = claimAfter(place, seen, owner);
    if (generation !== undefined) return { generation };
  }
}

/** Says that the Session of `place`'s claim `generation` started. */
export function markStarted(place: SessionPlace, generation: number): void {
  try {
    writeFileSync(startedFile(claimFolder(place), generation), "", {
      mode: PRIVATE_FILE,
      flag: "wx",
    });
  } catch {
    // Already said, or a later claim cleared the generation.
  }
}

/** Says that the Session of `place`'s claim `generation` ended: from then
 * on the folder has no Session of it. */
export function releaseRecord(place: SessionPlace, generation: number): void {
  try {
    writeFileSync(endedFile(claimFolder(place), generation), "", {
      mode: PRIVATE_FILE,
      flag: "wx",
    });
  } catch {
    // Already said, or a later claim cleared the generation.
  }
}

/** The `ayme` command line of `word` for `place`'s Session. */
const commandFor = (place: SessionPlace, word: string) =>
  commandLine(nameOf(place), word);

/** `place`'s Session, as a sentence names it after "A" or "No". */
const session = (place: SessionPlace) =>
  nameOf(place) === DEFAULT_NAME ? "Session" : `Session named ${nameOf(place)}`;

/** Why `place`'s Session cannot start while `holder` keeps its name. */
export const alreadyOpen = (
  place: SessionPlace,
  holder: SessionRecord
): string =>
  `A ${session(place)} is already open in ${place.projectDir}, in process ${holder.pid}. End it with ${commandFor(place, "close")} first.`;

/** Why a command reaches no Session of `place`, while the Sessions named
 * `open` are open in its folder. */
export const notOpen = (
  place: SessionPlace,
  open: readonly string[]
): string =>
  open.length === 0
    ? `No ${session(place)} is open in ${place.projectDir}. Start one with ${commandFor(place, "open")}.`
    : `No Session named ${nameOf(place)} is open in ${place.projectDir}. The Sessions open there are named: ${open.join(", ")}. Start one with ${commandFor(place, "open")}.`;

/** Why a command that waited for the Session of `record` to listen has no
 * answer from it. */
export const endedBeforeAnswer = (record: SessionRecord): string =>
  `The Session in process ${record.pid} ended before it answered.`;

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
