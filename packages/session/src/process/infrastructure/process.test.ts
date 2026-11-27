import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";

import { scriptedBrowser } from "../../../testing";
import { serveSession } from "./background";
import { askSession, openSession } from "./commands";
import {
  claimAfter,
  claimRecord,
  liveRecord,
  privateFolder,
  processStart,
  readClaim,
  releaseRecord,
  thisProcess,
  type SessionRecord,
} from "./record";
import { send } from "./wire";

/** A folder of the test's own, removed when it ends. */
function folder(name: string): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), `ayme-${name}-`)));
  onTestFinished(() => rmSync(made, { recursive: true, force: true }));
  return made;
}

let cacheDir: string;
let projectDir: string;
beforeEach(() => {
  cacheDir = folder("cache");
  vi.stubEnv("AYME_CACHE_DIR", cacheDir);
  projectDir = folder("project");
});

/** A Session's own folder, as the starting command makes it, removed when
 * the test ends. */
function sessionFolder() {
  const made = privateFolder();
  onTestFinished(() => rmSync(made.folder, { recursive: true, force: true }));
  return made;
}

/** Serves a Session on a scripted browser in this process, as the
 * background process does, on a socket the folder's claim names, until the
 * test ends. */
async function serve({ socket = sessionFolder().socket } = {}) {
  const { layer, browser } = scriptedBrowser();
  const scope = Effect.runSync(Scope.make());
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const served = await Effect.runPromise(
    serveSession({ socket, request: { open: { headed: false } } }).pipe(
      Effect.provide(layer),
      Scope.provide(scope),
      Effect.result
    )
  );
  return {
    served,
    browser,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

/** Claims the folder for this process and serves its Session there; the
 * claim's Session ends with the scope. */
async function claimAndServe() {
  const { socket } = sessionFolder();
  const claim = claimRecord(projectDir, { ...thisProcess(), socket });
  if (!("generation" in claim)) throw new Error("the folder has a Session");
  const serving = await serve({ socket });
  return {
    ...serving,
    close: async () => {
      await serving.close();
      releaseRecord(projectDir, claim.generation);
    },
  };
}

/** Another process, as the owner of a claim: it runs until it is ended or
 * the test ends. */
async function otherProcess(): Promise<
  Omit<SessionRecord, "socket"> & { end(): Promise<void> }
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

/** A claim of the folder whose process is gone. */
async function goneSession() {
  const gone = await otherProcess();
  claimRecord(projectDir, { ...gone, socket: "gone.sock" });
  await gone.end();
}

/** Whether `promise` is still pending after `ms`. */
async function pendingAfter(
  promise: Promise<unknown>,
  ms: number
): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

it("a command in a folder with no Session says so", async () => {
  expect(await askSession(projectDir, { stop: {} })).toEqual({
    ok: false,
    text: `No Session is open in ${projectDir}. Start one with ayme open.`,
  });
});

it("a command reaches the Session of its folder, and once the Session ends its folder has none", async () => {
  const { served, close } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;

  expect(await askSession(projectDir, { stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  await Effect.runPromise(served.success.ended);
  await close();

  expect(await askSession(projectDir, { stop: {} })).toMatchObject({
    ok: false,
    text: expect.stringContaining("No Session is open"),
  });
});

it("a start in a folder whose Session runs is refused, also when another process holds it", async () => {
  const holder = await otherProcess();
  claimRecord(projectDir, { ...holder, socket: "held.sock" });

  expect(
    claimRecord(projectDir, { ...thisProcess(), socket: "mine.sock" })
  ).toEqual({
    holder: { pid: holder.pid, since: holder.since, socket: "held.sock" },
  });
});

it("opening a Session in a folder that has one is refused before any process starts", async () => {
  const { served } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;

  const answer = await openSession({
    projectDir,
    request: { open: { headed: false } },
    // A process that would fail otherwise.
    processCommand: ["-e", "console.log('started'); process.exit(9)"],
  });

  expect(answer).toEqual({
    ok: false,
    text: `A Session is already open in ${projectDir}, in process ${process.pid}. End it with ayme close first.`,
  });
});

it("two starts that read a folder whose Session is gone at the same moment do not both claim it", async () => {
  await goneSession();
  const [first, second] = [await otherProcess(), await otherProcess()];

  const seenByFirst = readClaim(projectDir);
  const seenBySecond = readClaim(projectDir);
  expect(seenBySecond.live).toBe(false);

  expect(
    claimAfter(projectDir, seenByFirst, { ...first, socket: "first.sock" })
  ).toBeDefined();
  expect(
    claimAfter(projectDir, seenBySecond, { ...second, socket: "second.sock" })
  ).toBeUndefined();
  expect(liveRecord(projectDir)).toMatchObject({ pid: first.pid });
});

it("a start that read the folder before later Sessions started and ended takes it from none of them", async () => {
  await goneSession();
  const [late, first, next] = [
    await otherProcess(),
    await otherProcess(),
    await otherProcess(),
  ];
  const seenLate = readClaim(projectDir);

  const claimed = claimRecord(projectDir, { ...first, socket: "first.sock" });
  if (!("generation" in claimed)) throw new Error("not claimed");
  releaseRecord(projectDir, claimed.generation);
  claimRecord(projectDir, { ...next, socket: "next.sock" });

  expect(
    claimAfter(projectDir, seenLate, { ...late, socket: "late.sock" })
  ).toBeUndefined();
  expect(liveRecord(projectDir)).toMatchObject({ pid: next.pid });
});

it("a record whose process id now belongs to another process is no Session", async () => {
  claimRecord(projectDir, {
    pid: process.pid,
    since: "Sat Jan  1 00:00:00 2000",
    socket: "reused.sock",
  });

  expect(liveRecord(projectDir)).toBeUndefined();
  expect(await askSession(projectDir, { stop: {} })).toMatchObject({
    ok: false,
    text: expect.stringContaining("No Session is open"),
  });
});

/** A process that has exited but that its parent has not reaped: what an
 * orphan is in a container whose first process reaps none. */
async function zombie(): Promise<Omit<SessionRecord, "socket">> {
  // The shell starts the child, then becomes a sleep that never waits for
  // it.
  const parent = spawn("sh", ["-c", "sleep 0.2 & echo $!; exec sleep 30"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  onTestFinished(() => void parent.kill());
  const [line] = (await once(parent.stdout, "data")) as [Buffer];
  const pid = Number.parseInt(line.toString(), 10);
  const since = processStart(pid)!;
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { pid, since };
}

it("a record whose process has exited, though nobody reaped it, is no Session", async () => {
  claimRecord(projectDir, { ...(await zombie()), socket: "zombie.sock" });

  expect(liveRecord(projectDir)).toBeUndefined();
  expect(await askSession(projectDir, { stop: {} })).toMatchObject({
    ok: false,
    text: expect.stringContaining("No Session is open"),
  });
});

it("a command sent while the Session's process starts, before it listens, waits for the start", async () => {
  const { socket } = sessionFolder();
  claimRecord(projectDir, { ...thisProcess(), socket });

  const answer = askSession(projectDir, { stop: {} });
  expect(await pendingAfter(answer, 100)).toBe(true);
  await serve({ socket });

  expect(await answer).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
});

it("the start is answered by its process over the IPC channel, in full, however soon the process ends", async () => {
  const text = `${"Your Page Objects did not build. ".repeat(3000)}End.`;

  const answer = await openSession({
    projectDir,
    request: { open: { headed: false } },
    processCommand: [
      "-e",
      `process.once("message", () => process.send(${JSON.stringify({ ok: false, text })}, () => process.exit(1)))`,
    ],
  });

  expect(answer).toEqual({ ok: false, text });
});

it("a process that ends before it answers is answered with what it printed", async () => {
  const answer = await openSession({
    projectDir,
    request: { open: { headed: false } },
    processCommand: [
      "-e",
      "console.error('Cannot find module ayme'); process.exit(1)",
    ],
  });

  expect(answer).toEqual({ ok: false, text: "Cannot find module ayme" });
});

it("a socket path too long for a local socket fails the start with why", async () => {
  const { served } = await serve({
    socket: join(folder("socket"), `${"long".repeat(30)}.sock`),
  });

  expect(served).toMatchObject({
    _tag: "Failure",
    failure: {
      message: expect.stringMatching(
        /^ayme cannot listen at .*: a local socket's path has at most \d+ bytes\. Set TMPDIR to a shorter folder\.$/
      ),
    },
  });
});

it("a socket that cannot be listened on fails the start with why", async () => {
  const { served } = await serve({
    socket: join(folder("socket"), "missing", "s.sock"),
  });

  expect(served).toMatchObject({
    _tag: "Failure",
    failure: {
      message: expect.stringContaining("ayme could not listen at"),
    },
  });
});

it("only the user can reach a Session: its socket's folder, its claim and its record are theirs alone", async () => {
  const { socket, log } = sessionFolder();
  claimRecord(projectDir, { ...thisProcess(), socket });
  const [claims] = readdirSync(join(cacheDir, "sessions"));
  const claimFolder = join(cacheDir, "sessions", claims!);
  const mode = (path: string) => statSync(path).mode & 0o777;

  expect(mode(dirname(socket))).toBe(0o700);
  expect(dirname(log)).toBe(dirname(socket));
  expect(mode(claimFolder)).toBe(0o700);
  expect(mode(join(claimFolder, "1.json"))).toBe(0o600);
});

it("a request the Session does not know is answered so, and the Session goes on", async () => {
  const { served } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;
  const { socket } = liveRecord(projectDir)!;

  for (const request of [{ nope: {} }, "not a request"])
    expect(await send(socket, request as never)).toEqual({
      ok: false,
      text: "ayme does not know this request. Update ayme, or run ayme --help.",
    });

  expect(await askSession(projectDir, { stop: {} })).toMatchObject({
    ok: true,
  });
});
