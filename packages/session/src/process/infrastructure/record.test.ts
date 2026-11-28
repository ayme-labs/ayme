import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

// The user's home folder, which a test that needs one sets: os.homedir()
// ignores a HOME set in a worker thread, where Stryker runs the tests.
const home = vi.hoisted(() => ({ folder: undefined as string | undefined }));
vi.mock("node:os", async (actual) => ({
  ...(await actual<typeof import("node:os")>()),
  homedir: () => {
    if (home.folder === undefined) throw new Error("no home folder set");
    return home.folder;
  },
}));

import { listSessions } from "./commands";
import {
  claimRecord,
  liveRecord,
  markStarted,
  processStart,
  readClaim,
  releaseRecord,
  unusableName,
  type SessionPlace,
  type SessionRecord,
} from "./record";

// The claims of a folder's Sessions in the user's cache folder, read and
// made as the commands do. process.test.ts reaches them through the
// commands; these tests look at what a claim leaves in the cache folder.

/** A folder of the test's own, removed when it ends. */
function folder(name: string): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), `ayme-${name}-`)));
  onTestFinished(() => rmSync(made, { recursive: true, force: true }));
  return made;
}

let cacheDir: string;
let place: SessionPlace;
beforeEach(() => {
  cacheDir = folder("cache");
  vi.stubEnv("AYME_CACHE_DIR", cacheDir);
  place = { projectDir: folder("project") };
});
afterEach(() => {
  vi.unstubAllEnvs();
  home.folder = undefined;
});

/** Another process, as the owner of a claim: it runs until it is ended or
 * the test ends. */
async function otherProcess(): Promise<
  Omit<SessionRecord, "socket" | "name"> & { end(): Promise<void> }
> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], {
    stdio: "ignore",
  });
  await once(child, "spawn");
  onTestFinished(() => void child.kill());
  const pid = child.pid!;
  return {
    pid,
    since: processStart(pid)!,
    end: async () => {
      child.kill();
      await once(child, "exit");
    },
  };
}

/** Claims `of` for `owner` and resolves with the claim's generation. */
function claim(of: SessionPlace, owner: Omit<SessionRecord, "name">): number {
  const claimed = claimRecord(of, owner);
  if (!("generation" in claimed)) throw new Error("the name has a Session");
  return claimed.generation;
}

/** The files of the only claim folder under `sessions`. */
function claimFiles(sessions = join(cacheDir, "sessions")) {
  const [claims, ...more] = readdirSync(sessions);
  if (claims === undefined || more.length > 0)
    throw new Error(`not one claim folder in ${sessions}`);
  const claimFolder = join(sessions, claims);
  return { folder: claimFolder, files: readdirSync(claimFolder).sort() };
}

it("a name of 64 characters can name a Session", () => {
  expect(
    unusableName({ projectDir: "", name: "n".repeat(64) })
  ).toBeUndefined();
});

it("a claim leaves its record alone in the cache folder, and clears the records and marks of the generations before it", async () => {
  const [first, second] = [await otherProcess(), await otherProcess()];
  const before = claim(place, { ...first, socket: "1.sock" });
  markStarted(place, before);
  releaseRecord(place, before);
  expect(claimFiles().files).toEqual(["1.ended", "1.json", "1.started"]);

  claim(place, { ...second, socket: "2.sock" });

  expect(claimFiles().files).toEqual(["2.json"]);
});

it("a name's claims go on past the ninth", async () => {
  const owner = await otherProcess();
  for (let generation = 1; generation < 10; generation++)
    releaseRecord(place, claim(place, { ...owner, socket: "s.sock" }));

  expect(claim(place, { ...owner, socket: "10.sock" })).toBe(10);
  expect(liveRecord(place)).toMatchObject({ socket: "10.sock" });
});

it("a record that cannot be read is no Session, and the next start claims the generation after it", async () => {
  const owner = await otherProcess();
  claim(place, { ...owner, socket: "s.sock" });
  writeFileSync(join(claimFiles().folder, "1.json"), "{");

  expect(readClaim(place)).toEqual({
    generation: 1,
    live: false,
    started: false,
  });
  expect(claim(place, { ...owner, socket: "next.sock" })).toBe(2);
});

it("the marks of a Session's start and end are the user's alone", async () => {
  const owner = await otherProcess();
  const generation = claim(place, { ...owner, socket: "s.sock" });
  markStarted(place, generation);
  releaseRecord(place, generation);
  const { folder: claimFolder } = claimFiles();
  const mode = (file: string) => statSync(join(claimFolder, file)).mode & 0o777;

  expect(mode("1.started")).toBe(0o600);
  expect(mode("1.ended")).toBe(0o600);
});

it("list shows the folder's Sessions in the order of their names, whatever order they started in", async () => {
  const owner = await otherProcess();
  for (const name of ["D", "c", "B", "a"])
    claim({ ...place, name }, { ...owner, socket: `${name}.sock` });

  expect(listSessions(place.projectDir)).toMatchObject({
    data: {
      sessions: ["a", "B", "c", "D"].map((name) => ({ name })),
    },
  });
});

/** Runs the test as if on `platform`, in a home folder of its own, with no
 * cache folder set for ayme: the home folder is returned. */
function onPlatform(platform: NodeJS.Platform): string {
  home.folder = folder("home");
  vi.stubEnv("AYME_CACHE_DIR", undefined);
  vi.stubEnv("XDG_CACHE_HOME", undefined);
  const real = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...real, value: platform });
  onTestFinished(() => void Object.defineProperty(process, "platform", real));
  return home.folder;
}

it("without AYME_CACHE_DIR, a Session's claims are in the user's cache folder on macOS", () => {
  const homeFolder = onPlatform("darwin");

  claim(place, { pid: 1, since: "then", socket: "s.sock" });

  expect(
    claimFiles(join(homeFolder, "Library", "Caches", "ayme", "sessions")).files
  ).toEqual(["1.json"]);
});

it("without AYME_CACHE_DIR, a Session's claims are in XDG_CACHE_HOME elsewhere, or in ~/.cache without it", () => {
  const homeFolder = onPlatform("linux");
  const xdg = folder("xdg");

  claim(place, { pid: 1, since: "then", socket: "s.sock" });
  vi.stubEnv("XDG_CACHE_HOME", xdg);
  claim(place, { pid: 1, since: "then", socket: "s.sock" });

  expect(
    claimFiles(join(homeFolder, ".cache", "ayme", "sessions")).files
  ).toEqual(["1.json"]);
  expect(claimFiles(join(xdg, "ayme", "sessions")).files).toEqual(["1.json"]);
});

// A slim container may have no ps: on Linux, a process's start is read from
// /proc.
it.runIf(process.platform === "linux")(
  "on Linux, a process's start is known without ps",
  () => {
    vi.stubEnv("PATH", "");

    expect(processStart(process.pid)).toEqual(expect.any(String));
  }
);

it("a process's start tells it from a process started later, as one that is given its pid would be", async () => {
  const first = await otherProcess();
  // ps tells a start to the second.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const later = await otherProcess();

  expect(later.since).toEqual(expect.any(String));
  expect(later.since).not.toBe(first.since);
});
