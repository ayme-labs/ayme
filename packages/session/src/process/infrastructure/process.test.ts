import { execFileSync, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  mkdtempSync,
  readdirSync,
  writeFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";

import { scriptedBrowser } from "../../../testing";
import { serveProcess, serveSession, type Opener } from "./background";
import {
  askCall,
  askSession,
  listSessions,
  openSession,
  PARAMS_FILE_LIMIT_BYTES,
} from "./commands";
import {
  claimAfter,
  claimRecord,
  liveRecord,
  markStarted,
  privateFolder,
  processStart,
  readClaim,
  releaseRecord,
  thisProcess,
  type SessionPlace,
  type SessionRecord,
} from "./record";
import type { SessionAnswer } from "../../session/domain";
import { send } from "./wire";

/** A folder of the test's own, removed when it ends. */
function folder(name: string): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), `ayme-${name}-`)));
  onTestFinished(() => rmSync(made, { recursive: true, force: true }));
  return made;
}

let cacheDir: string;
let projectDir: string;
/** The folder's Session of the default name. */
let place: SessionPlace;
beforeEach(() => {
  cacheDir = folder("cache");
  vi.stubEnv("AYME_CACHE_DIR", cacheDir);
  projectDir = folder("project");
  place = { projectDir };
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
    serveSession({
      socket,
      request: { open: { headed: false } },
      name: "default",
    }).pipe(Effect.provide(layer), Scope.provide(scope), Effect.result)
  );
  return {
    served,
    browser,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

/** Claims the folder for this process and serves its Session there; the
 * claim's Session ends with the scope. */
async function claimAndServe(claimed: SessionPlace = place) {
  const { socket } = sessionFolder();
  const claim = claimRecord(claimed, { ...thisProcess(), socket });
  if (!("generation" in claim)) throw new Error("the folder has a Session");
  const serving = await serve({ socket });
  return {
    ...serving,
    close: async () => {
      await serving.close();
      releaseRecord(claimed, claim.generation);
    },
  };
}

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

/** A claim of the folder whose process is gone. */
async function goneSession() {
  const gone = await otherProcess();
  claimRecord(place, { ...gone, socket: "gone.sock" });
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
  expect(await askSession(place, { stop: {} })).toEqual({
    ok: false,
    text: `No Session is open in ${projectDir}. Start one with ayme -s=default open.`,
  });
});

it("a command whose name no open Session has says so, and names the Sessions that are open", async () => {
  const holder = await otherProcess();
  claimRecord({ projectDir, name: "two" }, { ...holder, socket: "2.sock" });
  claimRecord({ projectDir, name: "one" }, { ...holder, socket: "1.sock" });

  expect(await askSession(place, { stop: {} })).toEqual({
    ok: false,
    text: `No Session named default is open in ${projectDir}. The Sessions open there are named: one, two. Start one with ayme -s=default open.`,
  });
  expect(
    await askSession({ projectDir, name: "three" }, { stop: {} })
  ).toMatchObject({
    text: expect.stringMatching(
      /^No Session named three is open in .*\. The Sessions open there are named: one, two\. Start one with ayme -s=three open\.$/
    ),
  });
});

it("a command reaches the Session of its folder, and once the Session ends its folder has none", async () => {
  const { served, close } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;

  expect(await askSession(place, { stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  await Effect.runPromise(served.success.ended);
  await close();

  expect(await askSession(place, { stop: {} })).toMatchObject({
    ok: false,
    text: expect.stringContaining("No Session is open"),
  });
});

it("a start in a folder whose Session runs is refused, also when another process holds it", async () => {
  const holder = await otherProcess();
  claimRecord(place, { ...holder, socket: "held.sock" });

  expect(claimRecord(place, { ...thisProcess(), socket: "mine.sock" })).toEqual(
    {
      holder: {
        name: "default",
        pid: holder.pid,
        since: holder.since,
        socket: "held.sock",
      },
    }
  );
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
    text: `A Session is already open in ${projectDir}, in process ${process.pid}. End it with ayme -s=default close first.`,
  });
});

it("two starts that read a folder whose Session is gone at the same moment do not both claim it", async () => {
  await goneSession();
  const [first, second] = [await otherProcess(), await otherProcess()];

  const seenByFirst = readClaim(place);
  const seenBySecond = readClaim(place);
  expect(seenBySecond.live).toBe(false);

  expect(
    claimAfter(place, seenByFirst, { ...first, socket: "first.sock" })
  ).toBeDefined();
  expect(
    claimAfter(place, seenBySecond, { ...second, socket: "second.sock" })
  ).toBeUndefined();
  expect(liveRecord(place)).toMatchObject({ pid: first.pid });
});

it("a start that read the folder before later Sessions started and ended takes it from none of them", async () => {
  await goneSession();
  const [late, first, next] = [
    await otherProcess(),
    await otherProcess(),
    await otherProcess(),
  ];
  const seenLate = readClaim(place);

  const claimed = claimRecord(place, { ...first, socket: "first.sock" });
  if (!("generation" in claimed)) throw new Error("not claimed");
  releaseRecord(place, claimed.generation);
  claimRecord(place, { ...next, socket: "next.sock" });

  expect(
    claimAfter(place, seenLate, { ...late, socket: "late.sock" })
  ).toBeUndefined();
  expect(liveRecord(place)).toMatchObject({ pid: next.pid });
});

it("a record whose process id now belongs to another process is no Session", async () => {
  claimRecord(place, {
    pid: process.pid,
    since: "Sat Jan  1 00:00:00 2000",
    socket: "reused.sock",
  });

  expect(liveRecord(place)).toBeUndefined();
  expect(await askSession(place, { stop: {} })).toMatchObject({
    ok: false,
    text: expect.stringContaining("No Session is open"),
  });
});

it("a record whose process ended but was never reaped, as in a container without an init process, is no Session", async () => {
  // `sleep 0.3` outlives the shell, which becomes `sleep 60` and never
  // waits for it: once it ends, it stays as a zombie until `sleep 60` ends.
  const parent = spawn("sh", ["-c", "sleep 0.3 & echo $!; exec sleep 60"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  onTestFinished(() => void parent.kill());
  const [printed] = (await once(parent.stdout!, "data")) as [Buffer];
  const pid = Number(printed.toString());
  claimRecord(place, { pid, since: processStart(pid)!, socket: "z.sock" });

  await vi.waitFor(() => expect(liveRecord(place)).toBeUndefined());
});

it("a command sent while the Session's process starts, before it listens, waits for the start", async () => {
  const { socket } = sessionFolder();
  claimRecord(place, { ...thisProcess(), socket });

  const answer = askSession(place, { stop: {} });
  expect(await pendingAfter(answer, 100)).toBe(true);
  await serve({ socket });

  expect(await answer).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
});

it("a command waiting for a start stays with the claim it found: when another start of the name replaces it, the command is answered about the first, and the replacement goes on", async () => {
  const first = await otherProcess();
  const claimed = claimRecord(place, {
    ...first,
    socket: sessionFolder().socket,
  });
  if (!("generation" in claimed)) throw new Error("not claimed");
  const answer = askSession(place, { stop: {} });
  expect(await pendingAfter(answer, 100)).toBe(true);

  // The first start ends before it listens, and a second claims the name
  // at once.
  releaseRecord(place, claimed.generation);
  const { socket } = sessionFolder();
  claimRecord(place, { ...thisProcess(), socket });
  await serve({ socket });

  expect(await answer).toEqual({
    ok: false,
    text: `The Session in process ${first.pid} ended before it answered.`,
  });
  expect(await askSession(place, { tools: {} })).toMatchObject({ ok: true });
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
  claimRecord(place, { ...thisProcess(), socket });
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
  const { socket } = liveRecord(place)!;

  for (const request of [{ nope: {} }, "not a request"])
    expect(await send(socket, request as never)).toEqual({
      ok: false,
      text: "ayme does not know this request. Update ayme, or run ayme --help.",
    });

  expect(await askSession(place, { stop: {} })).toMatchObject({
    ok: true,
  });
});

it("a call reaches the Session with the tool's input as --params gives it: JSON, a file of the folder, or none", async () => {
  const { served, browser } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;
  writeFileSync(
    join(projectDir, "add.json"),
    '{"id":"po1","args":{"item":"Milk"}}'
  );

  for (const params of ['{"id":"po1"}', "@add.json", undefined])
    expect(await askCall(place, "Basket.add", params)).toMatchObject({
      ok: true,
    });

  expect(browser.runs).toEqual([
    { tool: "Basket.add", input: { id: "po1" } },
    { tool: "Basket.add", input: { id: "po1", args: { item: "Milk" } } },
    { tool: "Basket.add", input: {} },
  ]);
});

it("--params that is not JSON, or names a file that cannot be read, is answered with why and starts no Run", async () => {
  const { served, browser } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;

  expect(await askCall(place, "Basket.add", "{id: po1}")).toEqual({
    ok: false,
    text: expect.stringMatching(
      /^--params is not JSON: .+\. Give the tool's input as one JSON object, as ayme -s=default tools prints its parameters\.$/
    ),
  });
  expect(await askCall(place, "Basket.add", "@missing.json")).toEqual({
    ok: false,
    text: expect.stringMatching(
      /^--params @missing\.json names a file ayme cannot read: ENOENT.*\.$/
    ),
  });
  expect(browser.runs).toEqual([]);
});

it("--params @<file> reads only a regular file up to its size limit, and refuses a named pipe or a larger file at once with why", async () => {
  const { served, browser } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;
  // Nothing ever writes to the pipe: reading it would block for ever.
  execFileSync("mkfifo", [join(projectDir, "pipe")]);
  writeFileSync(
    join(projectDir, "large.json"),
    `"${"x".repeat(PARAMS_FILE_LIMIT_BYTES)}"`
  );

  expect(await askCall(place, "Basket.add", "@pipe")).toEqual({
    ok: false,
    text: "--params @pipe names something that is not a regular file. Give a file of JSON.",
  });
  expect(await askCall(place, "Basket.add", "@large.json")).toEqual({
    ok: false,
    text: "--params @large.json names a file larger than 1 MB, the most ayme reads for a tool's input.",
  });
  expect(browser.runs).toEqual([]);
});

it("a command whose answer cannot be turned into text is answered with why, and the Session goes on", async () => {
  const { served, browser } = await claimAndServe();
  if (served._tag !== "Success") throw served.failure;
  // A value a Page Object returned, which throws when it is written out.
  const result = Object.defineProperty({}, "toJSON", {
    value: () => {
      throw new Error("This value cannot be written.");
    },
  });
  browser.answerRuns(async () => ({ settled: true, result }));

  expect(await askCall(place, "Basket.add", undefined)).toEqual({
    ok: false,
    text: "ayme could not write the answer to this command: This value cannot be written.",
  });
  expect(await askSession(place, { stop: {} })).toMatchObject({ ok: true });
});

it("Sessions of different names run side by side in one folder, and a command reaches the one it names", async () => {
  const review = { projectDir, name: "review" };
  const first = await claimAndServe();
  const second = await claimAndServe(review);
  if (first.served._tag !== "Success" || second.served._tag !== "Success")
    throw new Error("not served");

  expect(await askSession(review, { stop: {} })).toMatchObject({ ok: true });
  expect(await Effect.runPromise(second.served.success.ended)).toBe("stopped");
  await second.close();

  expect(await askSession(review, { stop: {} })).toEqual({
    ok: false,
    text: `No Session named review is open in ${projectDir}. The Sessions open there are named: default. Start one with ayme -s=review open.`,
  });
  expect(liveRecord(place)).toMatchObject({ pid: process.pid });
});

it("the default name is the Session's name when none is given", async () => {
  const { served } = await claimAndServe({ projectDir, name: "default" });
  if (served._tag !== "Success") throw served.failure;

  expect(await askSession({ projectDir }, { stop: {} })).toMatchObject({
    ok: true,
  });
});

it("opening a Session of a name in use is refused, naming it", async () => {
  const review = { projectDir, name: "review" };
  const { served } = await claimAndServe(review);
  if (served._tag !== "Success") throw served.failure;

  expect(
    await openSession({
      ...review,
      request: { open: { headed: false } },
      processCommand: ["-e", "process.exit(9)"],
    })
  ).toEqual({
    ok: false,
    text: `A Session named review is already open in ${projectDir}, in process ${process.pid}. End it with ayme -s=review close first.`,
  });
});

/** A Session's process that starts as soon as it is told its claim, and
 * then runs until the test ends. */
const startsAtOnce = [
  "-e",
  'process.once("message", () => process.send({ ok: true, text: "started" }, () => process.disconnect())); setInterval(() => {}, 1e9)',
];

/** Ends the process of a place's live Session, if it has one, when the
 * test ends: called before the start, so that the process is ended however
 * the test goes. */
function endWithTest(of: SessionPlace) {
  onTestFinished(() => {
    const record = liveRecord(of);
    if (record) process.kill(record.pid);
  });
}

it("two starts of one name at the same moment: one starts and the other is refused", async () => {
  const review = { projectDir, name: "review" };
  const start = () =>
    openSession({
      ...review,
      request: { open: { headed: false } },
      processCommand: startsAtOnce,
    });

  endWithTest(review);
  const answers = await Promise.all([start(), start()]);

  expect(answers).toEqual(
    expect.arrayContaining([
      { ok: true, text: "started" },
      {
        ok: false,
        text: expect.stringMatching(
          /^A Session named review is already open in .*, in process \d+\. End it with ayme -s=review close first\.$/
        ),
      },
    ])
  );
});

it("two starts of different names at the same moment both start", async () => {
  const start = (name: string) =>
    openSession({
      projectDir,
      name,
      request: { open: { headed: false } },
      processCommand: startsAtOnce,
    });

  endWithTest({ projectDir, name: "one" });
  endWithTest({ projectDir, name: "two" });
  const answers = await Promise.all([start("one"), start("two")]);

  expect(answers).toEqual([
    { ok: true, text: "started" },
    { ok: true, text: "started" },
  ]);
});

/** Claims `of` for `owner`, as a start that succeeded. */
function startedSession(
  of: SessionPlace,
  owner: Omit<SessionRecord, "name">
): void {
  const claim = claimRecord(of, owner);
  if (!("generation" in claim)) throw new Error("the folder has a Session");
  markStarted(of, claim.generation);
}

it("list shows the live Sessions of the folder by name, and none of another folder's or one that ended", async () => {
  const holder = await otherProcess();
  const gone = await otherProcess();
  startedSession(place, { ...holder, socket: "default.sock" });
  startedSession(
    { projectDir, name: "review" },
    { ...holder, socket: "r.sock" }
  );
  claimRecord({ projectDir, name: "old" }, { ...gone, socket: "old.sock" });
  claimRecord(
    { projectDir: folder("other"), name: "elsewhere" },
    { ...holder, socket: "e.sock" }
  );
  await gone.end();

  expect(listSessions(projectDir)).toEqual({
    ok: true,
    text: [
      `Sessions in ${projectDir}:`,
      `default, in process ${holder.pid}`,
      `review, in process ${holder.pid}`,
    ].join("\n"),
    data: {
      sessions: [
        { name: "default", pid: holder.pid, starting: false },
        { name: "review", pid: holder.pid, starting: false },
      ],
    },
  });
});

it("list shows a Session whose start is still under way as starting", async () => {
  const holder = await otherProcess();
  claimRecord(place, { ...holder, socket: "default.sock" });

  expect(listSessions(projectDir)).toEqual({
    ok: true,
    text: [
      `Sessions in ${projectDir}:`,
      `default, in process ${holder.pid}, starting`,
    ].join("\n"),
    data: {
      sessions: [{ name: "default", pid: holder.pid, starting: true }],
    },
  });
});

it("list in a folder with no Session says so, and is no failure", () => {
  expect(listSessions(projectDir)).toEqual({
    ok: true,
    text: `No Session is open in ${projectDir}.`,
    data: { sessions: [] },
  });
});

it("names that differ only in case are two Sessions, also on a file system that ignores case", async () => {
  const [upper, lower] = [await otherProcess(), await otherProcess()];
  claimRecord({ projectDir, name: "Work" }, { ...upper, socket: "W.sock" });

  expect(
    claimRecord({ projectDir, name: "work" }, { ...lower, socket: "w.sock" })
  ).toMatchObject({ generation: 1 });
  expect(liveRecord({ projectDir, name: "Work" })).toMatchObject({
    pid: upper.pid,
  });
  expect(liveRecord({ projectDir, name: "work" })).toMatchObject({
    pid: lower.pid,
  });
});

it("a session name of up to 64 characters is used, and a longer one is refused", async () => {
  const longest = "n".repeat(64);
  const holder = await otherProcess();
  claimRecord({ projectDir, name: longest }, { ...holder, socket: "n.sock" });
  expect(liveRecord({ projectDir, name: longest })).toMatchObject({
    name: longest,
  });

  expect(
    await askSession({ projectDir, name: `${longest}n` }, { stop: {} })
  ).toEqual({
    ok: false,
    text: `"${longest}n" cannot name a Session: a name has at most 64 characters.`,
  });
});

it.each(["", "two words", "../up", "a/b"])(
  "a session name ayme cannot use is refused: %j",
  async (name) => {
    const why = {
      ok: false,
      text: `${JSON.stringify(name)} cannot name a Session: a name has letters, digits, ".", "_" and "-" only.`,
    };
    expect(await askSession({ projectDir, name }, { stop: {} })).toEqual(why);
    expect(
      await openSession({
        projectDir,
        name,
        request: { open: { headed: false } },
        processCommand: ["-e", "process.exit(9)"],
      })
    ).toEqual(why);
  }
);

/** The command that starts a Session's process, as the process sees it
 * over its IPC channel: the test sends the claim, and goes away, by hand.
 * `told` resolves with the answer to the start, and `listedWhenTold` with
 * what ayme list showed at that moment. */
function scriptedOpener() {
  const channel = new EventEmitter();
  let tellStart!: (answer: SessionAnswer) => void;
  const told = new Promise<SessionAnswer>((resolve) => (tellStart = resolve));
  let listed: SessionAnswer | undefined;
  const opener = Object.assign(channel, {
    connected: true,
    send: (answer: SessionAnswer, done: () => void) => {
      listed = listSessions(projectDir);
      tellStart(answer);
      done();
      return true;
    },
    disconnect: () => {
      opener.connected = false;
      channel.emit("disconnect");
    },
  });
  return {
    opener: opener as unknown as Opener,
    told,
    listedWhenTold: () => listed,
    claim: (generation: number) =>
      channel.emit("message", { claimed: generation }),
    goAway: () => opener.disconnect(),
  };
}

/** Claims the folder for this process, as the opening command does, and
 * runs the Session's process on a scripted browser in this process. */
function runProcess(opener: Opener) {
  const { socket } = sessionFolder();
  const claim = claimRecord(place, { ...thisProcess(), socket });
  if (!("generation" in claim)) throw new Error("the folder has a Session");
  const { layer, browser } = scriptedBrowser();
  const exitCode = serveProcess(
    { projectDir, socket, request: { open: { headed: false } } },
    opener,
    layer
  );
  return { generation: claim.generation, exitCode, browser };
}

it("a start whose opening command goes away right after sending the claim ends, and leaves no browser and no Session", async () => {
  const { opener, claim, goAway } = scriptedOpener();
  const { generation, exitCode, browser } = runProcess(opener);

  // Before the process watches for its opener going away.
  claim(generation);
  goAway();

  expect(await exitCode).toBe(1);
  // The start ends before or after it asked for a browser: none is held.
  expect(browser.asked.length === 0 || browser.released).toBe(true);
  expect(browser.hostedWith).toEqual([]);
  expect(liveRecord(place)).toBeUndefined();
});

it("a Session's process marks its claim started before it answers the start, and serves the Session until it ends", async () => {
  const { opener, claim, told, listedWhenTold } = scriptedOpener();
  const { generation, exitCode } = runProcess(opener);

  claim(generation);

  expect(await told).toMatchObject({ ok: true });
  expect(listedWhenTold()).toMatchObject({
    data: {
      sessions: [{ name: "default", pid: process.pid, starting: false }],
    },
  });
  expect(await askSession(place, { stop: {} })).toMatchObject({ ok: true });
  expect(await exitCode).toBe(0);
  expect(liveRecord(place)).toBeUndefined();
});
