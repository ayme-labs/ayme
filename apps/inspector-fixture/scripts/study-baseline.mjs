// Measures one arm of the Page Object study: how to run it is in
// study/baseline/README.md, what a run must be to count in study-report.mjs.
import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { homedir, loadavg } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

import { chromium } from "playwright";

import { LEFT_OUT } from "./check-goal-mirror.mjs";
import {
  cohortOf,
  digestOf,
  goalIdentities,
  NotAResult,
  preloads,
  projectRun,
  render,
} from "./study-report.mjs";

// The goal arms' hand-offs need this machine's model login, and CI has none.
if (process.env.CI) {
  console.error("study:baseline runs on your own machine, not in CI");
  process.exit(2);
}

const here = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(here, "../..");
const out = join(here, "study/baseline");
const RUNS = 3;

/**
 * Each arm's own pnpm script, unchanged, and the variables it runs with. The
 * goal arms replay read-only with the agent there for what does not replay;
 * their configs pin the `ayme mcp` port their recordings were made on, and
 * their scripts name their recordings' directory (`--cache-dir`).
 */
const ARMS = {
  arm1: {
    name: "Arm 1: plain goals",
    script: "test:goals",
    env: { AYME_E2E_CACHE: "read-only" },
  },
  arm2: { name: "Arm 2: Page Objects", script: "e2e", env: {} },
  arm3: {
    name: "Arm 3: goals with Page Object Tools",
    script: "test:goals:tools",
    env: { AYME_E2E_CACHE: "read-only" },
  },
};
const scripts = JSON.parse(
  readFileSync(join(here, "package.json"), "utf8")
).scripts;

/** Variables that change what a run replays or how; each run gets the arm's values and no others. */
const PINNED = [
  "AYME_E2E_REFRESH_AFTER_PO_CHANGE",
  "AYME_E2E_EXECUTOR",
  "AYME_E2E_CACHE",
  "AYME_E2E_DEBUG",
  "AYME_E2E_MCP_PORT",
  "AYME_E2E_APP_PORT",
  "AYME_E2E_STALE",
  "AYME_E2E_HALF_DONE",
  "E2E_CACHE_DIR",
];

const [armId, ...rest] = process.argv.slice(2);
if (armId === "render" && !rest.length) {
  writeReadme();
  process.exit(0);
}
const arm = ARMS[armId];
if (!arm || rest.length) {
  console.error("usage: pnpm study:baseline <arm1|arm2|arm3> | render");
  process.exit(2);
}
// Arms 1 and 2 run e2e as published; arm 3's launcher brings its own hook.
const preloaded = armId === "arm3" ? [] : preloads(process.env.NODE_OPTIONS);
if (preloaded.length) {
  console.error(
    `unset NODE_OPTIONS: ${armId} runs e2e as published, with nothing preloaded (${preloaded.join(", ")})`
  );
  process.exit(2);
}
const inherited = PINNED.filter(
  (name) =>
    process.env[name] !== undefined && process.env[name] !== arm.env[name]
);
if (inherited.length) {
  console.error(
    `unset ${inherited.join(", ")}: the baseline runs ${armId} without ${inherited.length > 1 ? "them" : "it"}`
  );
  process.exit(2);
}
// A number belongs to a commit only if nothing uncommitted ran with it.
// study/ is this script's own output.
const uncommitted = () => git("status", "--porcelain", "--", ":/", ":!study");
if (uncommitted()) {
  console.error(`commit first; uncommitted:\n${uncommitted()}`);
  process.exit(2);
}
const commit = git("rev-parse", "HEAD");
const runEnv = { E2E_TELEMETRY_DISABLED: "1", ...arm.env };
// The recordings are the ones committed at `commit`, as the tree is clean:
// the files git tracks in the directory the arm's script names.
const cacheDir = scripts[arm.script].match(/--cache-dir\s+(\S+)/)?.[1];
const recordings = cacheDir && { dir: cacheDir, ...trackedRecordings() };
if (recordings && !recordings.entries) {
  console.error(`${cacheDir} holds no committed recordings`);
  process.exit(2);
}

// `dist` is ignored by git, and the fixture serves the built packages.
const build = "turbo run build --filter=@ayme-dev/inspector-fixture^...";
run(
  "pnpm",
  [...build.split(" "), "--concurrency=2", "--output-logs=errors-only"],
  {
    cwd: root,
  }
);

const { shared, extras } = cohortOf(listTests(), LEFT_OUT);
const goals = cacheDir ? goalIdentities(here, "tests/goals") : undefined;
const expected = armId === "arm2" ? [...shared, ...extras] : shared;
const invocation = join(
  here,
  ".e2e/study",
  armId,
  new Date().toISOString().replace(/[:.]/g, "-")
);
mkdirSync(invocation, { recursive: true });
const appPort = await free(0);
const app = await startWarmApp(appPort, join(invocation, "vite.log"));
const summary = {
  arm: armId,
  name: arm.name,
  command: `pnpm study:baseline ${armId}`,
  commit,
  build: `pnpm ${build}, before the runs`,
  env: runEnv,
  ...(recordings && { recordings }),
  cohort: {
    shared: shared.length,
    others: extras.length,
    digest: digestOf(shared),
  },
  runs: [],
};
try {
  for (let i = 0; i < RUNS; i++) {
    const output = join(invocation, `run-${i + 1}`);
    console.log(`\n${arm.name}: run ${i + 1} of ${RUNS}`);
    // Other work on the machine slows a run; the page shows it beside the times.
    const loadAverage = loadavg().map((n) => +n.toFixed(2));
    const startedAt = Date.now();
    const startedMono = process.hrtime.bigint();
    const sleptBefore = lastSleep();
    const { status } = spawnSync(
      "pnpm",
      ["run", arm.script, "--workers", "1", "--output", output],
      {
        cwd: here,
        stdio: "inherit",
        env: armEnv({ AYME_E2E_APP_PORT: String(appPort) }),
      }
    );
    // Timed by the monotonic clock, which a wall-clock change cannot move.
    const commandWallMs = Number(
      (process.hrtime.bigint() - startedMono) / 1_000_000n
    );
    // A run the machine slept through times the sleep, and its pages may
    // have reloaded under it. macOS says when it last slept; elsewhere a
    // heuristic: the monotonic clock stops in a suspend on Linux and macOS,
    // so a gap between it and the wall clock suggests one.
    const clockGapMs = Date.now() - startedAt - commandWallMs;
    const slept =
      lastSleep() !== sleptBefore
        ? "macOS reports a sleep"
        : clockGapMs > 5_000 &&
          `the wall clock ran ${Math.round(clockGapMs / 1000)} s ahead of the monotonic clock`;
    try {
      if (slept)
        throw new NotAResult(`the machine slept during the run: ${slept}`);
      summary.runs.push({
        ...projectRun(join(output, "report.json"), {
          startedAfter: startedAt,
          commit,
          exitCode: status,
          expected,
          shared,
          clean,
          goals,
        }),
        commandWallMs,
        loadAverage,
      });
    } catch (error) {
      if (!(error instanceof NotAResult)) throw error;
      console.error(
        `\nstopped: run ${i + 1} is not a result, and ${armId}.json is unchanged:\n${error.message}`
      );
      process.exitCode = 1;
      break;
    }
  }
} finally {
  app.stop();
}

const changed = [
  git("rev-parse", "HEAD") !== commit && "the commit",
  uncommitted() && "the working tree",
  recordings &&
    trackedRecordings().digest !== recordings.digest &&
    "the recordings",
].filter(Boolean);
if (changed.length) {
  console.error(`not saved: ${changed.join(" and ")} changed during the runs`);
  process.exitCode = 1;
} else if (summary.runs.length === RUNS) {
  writeFormatted(join(out, `${armId}.json`), JSON.stringify(summary));
  writeReadme();
}

function armEnv(more = {}) {
  const env = { ...process.env };
  for (const name of PINNED) delete env[name];
  return { ...env, ...runEnv, ...more };
}

/** Free text in a committed file names no machine: no home, no checkout. */
function clean(text) {
  return text
    .replaceAll(root, "<checkout>")
    .replaceAll(homedir(), "~")
    .replace(/http:\/\/127\.0\.0\.1:\d+/g, "http://127.0.0.1:<port>");
}

/** The tests arm 2's config selects, which every arm's cohort derives from. */
function listTests() {
  const { stdout } = run(
    join(here, "node_modules/.bin/e2e"),
    ["list", "--config", "e2e.config.ts", "--reporter", "json"],
    { cwd: here, env: armEnv(), stdio: ["ignore", "pipe", "inherit"] }
  );
  return JSON.parse(stdout).pairs;
}

/** When macOS last went to sleep, or undefined where it does not say. */
function lastSleep() {
  return spawnSync("sysctl", ["-n", "kern.sleeptime"], {
    encoding: "utf8",
  }).stdout?.trim();
}

function free(port) {
  return new Promise((done) => {
    const server = createServer()
      .once("error", () => done(undefined))
      .listen(port, "127.0.0.1", () => {
        const { port: bound } = server.address();
        server.close(() => done(bound));
      });
  });
}

/** One Vite server for every run, its module graph loaded once by a browser so no run pays for a cold start. */
async function startWarmApp(port, log) {
  const server = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--config",
      "app/vite.config.ts",
      "--port",
      String(port),
      "--strictPort",
    ],
    // What e2e hands its app command (e2e's config reference, `command`).
    {
      cwd: here,
      stdio: ["ignore", openSync(log, "w"), openSync(log, "a")],
      detached: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
      },
    }
  );
  // pnpm starts Vite as its child: stop the whole group.
  server.stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  process.on("exit", server.stop);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => process.exit(130));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (let ready = false; !ready;) {
    if (server.exitCode !== null || Date.now() > deadline)
      throw new Error(
        `the fixture server did not answer on ${origin} within a minute; its log: ${log}`
      );
    ready = await new Promise((done) =>
      get(origin, (r) => done(r.resume().statusCode === 200)).on("error", () =>
        done(false)
      )
    );
    if (!ready) await setTimeout(250);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const html of readdirSync(join(here, "app")).filter((f) =>
    f.endsWith(".html")
  ))
    await page.goto(`${origin}/${html}`, { waitUntil: "networkidle" });
  await browser.close();
  return server;
}

/** The recordings git tracks, and a digest of their names and bytes, so a reader can tell which a baseline replayed; a file git ignores there changes neither. */
function trackedRecordings() {
  const files = git("ls-files", "--", cacheDir).split("\n").filter(Boolean);
  const hash = createHash("sha256");
  for (const file of files.sort())
    hash.update(basename(file)).update(readFileSync(join(here, file)));
  return { entries: files.length, digest: hash.digest("hex") };
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    console.error(`failed: ${command} ${args.join(" ")}`);
    process.exit(1);
  }
  return result;
}

function git(...args) {
  return spawnSync("git", args, { cwd: here, encoding: "utf8" }).stdout.trim();
}

function writeReadme() {
  const arms = Object.keys(ARMS).flatMap((id) => {
    const file = join(out, `${id}.json`);
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8"))] : [];
  });
  writeFormatted(join(out, "README.md"), render(arms, ARMS[armId] && armId));
}

/** Writes `text` as Prettier formats it, so a formatter that fails leaves the file as it was and the command exits non-zero. */
function writeFormatted(file, text) {
  const { stdout } = run(
    "pnpm",
    ["-w", "exec", "prettier", "--stdin-filepath", file],
    { cwd: here, input: text, stdio: ["pipe", "pipe", "inherit"] }
  );
  writeFileSync(file, stdout);
}
