// Measures one arm of the Page Object study (README.md, "Running"):
//
//   pnpm study:baseline <arm1|arm2|arm3> [--runs <n>] [--provisional <why>]
//   pnpm study:baseline render
//
// It serves the fixture pages from one Vite server it starts and warms, runs
// the arm's own script <n> times (3 by default) one after the other on that
// server, writes study/baseline/<arm>.json from each run's report.json, and
// renders study/baseline/README.md from every arm's file. `--provisional`
// marks the arm's numbers in the table until a run without it replaces them.
// `render` only rewrites the README from the arms' files.
import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

import { chromium } from "playwright";

const here = fileURLToPath(new URL("..", import.meta.url));
const out = join(here, "study/baseline");

/**
 * Each arm's own pnpm script, unchanged, and what this harness adds to it.
 * The goal arms replay read-only, with the agent there for what does not
 * replay, as arm 3's replays in its pull request were run; their `ayme mcp`
 * port is the one their recordings were made on, since the external
 * placement's steps replay only against that origin (e2e.goals.config.ts).
 * One worker everywhere: the goal configs allow no more, and the machine is
 * shared.
 */
const ARMS = {
  arm1: {
    name: "Arm 1: plain goals",
    script: "test:goals",
    env: { AYME_E2E_CACHE: "read-only", AYME_E2E_MCP_PORT: "9403" },
    cacheDir: ".e2e/goals-cache",
  },
  arm2: { name: "Arm 2: Page Objects", script: "e2e", env: {} },
  arm3: {
    name: "Arm 3: goals with Page Object Tools",
    script: "test:goals:tools",
    env: { AYME_E2E_CACHE: "read-only", AYME_E2E_MCP_PORT: "9585" },
    cacheDir: ".e2e/goals-tools-cache",
  },
};

const [armId, ...rest] = process.argv.slice(2);
if (armId === "render") {
  writeReadme();
  process.exit(0);
}
const arm = ARMS[armId];
const runsAt = rest.indexOf("--runs");
const runs = runsAt === -1 ? 3 : Number(rest[runsAt + 1]);
const provisionalAt = rest.indexOf("--provisional");
const provisional = provisionalAt === -1 ? undefined : rest[provisionalAt + 1];
if (!arm || !(runs >= 1) || provisional === "") {
  console.error(
    `usage: pnpm study:baseline <${Object.keys(ARMS).join("|")}> [--runs <n>] [--provisional <why>]`
  );
  process.exit(2);
}

const free = (port) =>
  new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(undefined))
      .listen(port, "127.0.0.1", () => {
        const { port: bound } = server.address();
        server.close(() => resolve(bound));
      });
  });

/** Waits while another checkout's `ayme mcp` holds the port the recordings need: the port is not ours to change. */
async function recordingPortFree() {
  const port = arm.env.AYME_E2E_MCP_PORT;
  if (!port || (await free(+port))) return;
  console.log(
    `port ${port}, which ${armId}'s recordings need, is taken: waiting`
  );
  while (!(await free(+port))) await setTimeout(10_000);
}

const appPort = await free(0);
const app = await startWarmApp(appPort);
const result = {
  arm: armId,
  name: arm.name,
  command: `pnpm study:baseline ${armId}`,
  commit: git("rev-parse", "HEAD"),
  ...(provisional && { provisional }),
  ...(arm.cacheDir && { cacheDigest: digestDir(join(here, arm.cacheDir)) }),
  runs: [],
};
try {
  for (let i = 0; i < runs; i++) {
    const output = `.e2e/study/${armId}/run-${i + 1}`;
    await recordingPortFree();
    console.log(`\n${arm.name}: run ${i + 1} of ${runs}`);
    const { status } = spawnSync(
      "pnpm",
      ["run", arm.script, "--workers", "1", "--output", output],
      {
        cwd: here,
        stdio: "inherit",
        env: { ...process.env, ...arm.env, AYME_E2E_APP_PORT: String(appPort) },
      }
    );
    const run = summarize(join(here, output, "report.json"), status);
    // Hand-offs run on this machine's model login. A run that hit its limit
    // measures the limit, not the arm: keep the arm's last file, and stop.
    if (run.usageLimit) {
      console.error(
        `stopped: run ${i + 1} hit the model's usage limit; ${armId}.json is unchanged`
      );
      process.exitCode = 1;
      break;
    }
    result.runs.push(run);
  }
} finally {
  app.stop();
}

if (result.runs.length === runs) {
  writeFileSync(join(out, `${armId}.json`), JSON.stringify(result, null, 2));
  writeReadme();
}

function writeReadme() {
  writeFileSync(join(out, "README.md"), render());
  spawnSync("pnpm", ["-w", "exec", "prettier", "--write", out], {
    stdio: "inherit",
  });
}

/** One Vite server for every run, its module graph loaded once by a browser so no run pays for a cold start. */
async function startWarmApp(port) {
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
      stdio: "ignore",
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
  for (let ready = false; !ready;) {
    if (server.exitCode !== null) throw new Error("the fixture server exited");
    ready = await new Promise((resolve) =>
      get(origin, (r) => resolve(r.resume().statusCode === 200)).on(
        "error",
        () => resolve(false)
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

/** A run's numbers, per test and in total, from e2e's report.json. */
function summarize(reportPath, exitCode) {
  const { run } = JSON.parse(readFileSync(reportPath, "utf8"));
  const tests = run.results.map((result) => {
    const steps = result.attempts.flatMap((a) => a.steps);
    const goals = steps.filter((s) => s.kind === "agent");
    const models = steps.flatMap((s) => (s.model ? [s.model] : []));
    const sum = (key) => models.reduce((n, m) => n + (m[key] ?? 0), 0);
    return {
      test: testKey(result),
      status: result.status,
      wallMs: result.attempts.reduce((n, a) => n + a.durationMs, 0),
      steps: goals.length,
      stepsWithoutModel: goals.filter((s) => !s.metrics?.modelCalls).length,
      // inputTokens includes the cached ones (@e2e-dev/acp's inputTokens).
      tokens: sum("inputTokens") + sum("outputTokens"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cacheReadTokens: sum("cacheReadTokens"),
      cacheWriteTokens: sum("cacheWriteTokens"),
      estimatedCostUsd: sum("estimatedCostUsd"),
      modelSteps: goals
        .filter((s) => s.metrics?.modelCalls)
        .map((s) => ({
          step: s.label,
          line: s.source?.line,
          cache: s.cache?.mode,
          reason: s.cache?.reason,
          detail: s.cache?.detail,
          tokens: (s.model?.inputTokens ?? 0) + (s.model?.outputTokens ?? 0),
        })),
      ...(result.status !== "passed" && {
        error: result.attempts.at(-1)?.error?.message?.slice(0, 600),
      }),
    };
  });
  const errors = JSON.stringify([run.errors, tests.map((t) => t.error)]);
  return {
    startedAt: run.startedAt,
    e2e: run.runner.version,
    exitCode,
    status: run.status,
    suiteWallMs: run.durationMs,
    estimatedCostUsd: run.usage.estimatedCostUsd,
    // The ACP agent's wording: "You've hit your 5-hour limit".
    usageLimit: /usage limit|rate limit|hour limit|weekly limit|quota/i.test(
      errors
    ),
    tests,
  };
}

/** A test's name in every arm: its file without the arm's suffix, then its title path. */
function testKey(result) {
  const file = basename(result.file).replace(/\.(e2e|goal)\.ts$/, "");
  return [file, ...result.titlePath].join(" › ");
}

/** What a set of recordings is, so a reader can tell which a baseline replayed. */
function digestDir(dir) {
  const hash = createHash("sha256");
  for (const f of readdirSync(dir).sort())
    hash.update(f).update(readFileSync(join(dir, f)));
  return hash.digest("hex");
}

function git(...args) {
  return spawnSync("git", args, { cwd: here, encoding: "utf8" }).stdout.trim();
}

/** The table, from every arm measured so far: the goal files' tests, then arm 2's other tests. */
function render() {
  const arms = Object.keys(ARMS).flatMap((id) => {
    try {
      return [JSON.parse(readFileSync(join(out, `${id}.json`), "utf8"))];
    } catch {
      return [];
    }
  });
  const goalArm = arms.find((a) => a.arm !== "arm2");
  const mirrored = new Set(goalArm?.runs[0]?.tests.map((t) => t.test) ?? []);
  const range = (values, format = String) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return lo === hi ? format(lo) : `${format(lo)}–${format(hi)}`;
  };
  const seconds = (ms) => `${(ms / 1000).toFixed(0)} s`;
  const usd = (n) => `$${n.toFixed(2)}`;
  const row = (a, keep) => {
    const per = a.runs.map((r) => r.tests.filter((t) => keep(t.test)));
    const total = (key) => per.map((ts) => ts.reduce((n, t) => n + t[key], 0));
    const passed = per.map(
      (ts) => ts.filter((t) => t.status === "passed").length
    );
    const goals = a.arm !== "arm2";
    return [
      a.provisional ? `${a.name} (provisional)` : a.name,
      `${range(passed)} of ${per[0].length}`,
      range(total("wallMs"), seconds),
      goals ? range(total("steps")) : "none",
      goals ? range(total("stepsWithoutModel")) : "none",
      goals ? range(total("tokens")) : "none",
      goals ? range(total("estimatedCostUsd"), usd) : "none",
      String(a.runs.length),
    ];
  };
  const table = (rows) =>
    [
      "| Arm | Tests passed | Test time | Goal steps | With no model call | Tokens | e2e's cost estimate | Runs |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n");
  const arm2 = arms.find((a) => a.arm === "arm2");
  const handOffs = arms
    .filter((a) => a.arm !== "arm2")
    .map((a) => {
      const seen = new Map();
      for (const r of a.runs)
        for (const t of r.tests)
          for (const s of t.modelSteps) {
            const key = `${t.test} › "${s.step}" (${s.cache ?? "no cache"}${s.reason ? `, ${s.reason}` : ""})`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
      const lines = [...seen].map(
        ([key, n]) => `- ${key}: ${n} of ${a.runs.length} runs`
      );
      return `${a.name}:\n\n${lines.join("\n") || "- none"}`;
    });
  return `# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign, measured by \`pnpm study:baseline <arm1|arm2|arm3>\` ([the script](../../scripts/study-baseline.mjs) says how), which rewrites this page from the data beside it. Each cell is the range over an arm's runs. Per test, and each run's own numbers: \`<arm>.json\`.

## The goal files' tests in every arm

${table(arms.map((a) => row(a, (t) => mirrored.has(t))))}
${arms
  .filter((a) => a.provisional)
  .map((a) => `\nProvisional, ${a.name}: ${a.provisional}.\n`)
  .join("")}
## Arm 2's other tests

The tests with no action to turn into a goal (\`LEFT_OUT\` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

${arm2 && mirrored.size ? table([row(arm2, (t) => !mirrored.has(t))]) : "Not measured yet."}

## Goal steps that reached the model

${handOffs.join("\n\n")}
`;
}
