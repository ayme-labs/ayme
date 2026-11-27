/**
 * One first-install run: a developer's project with ayme installed from a
 * local registry, a worker told only which browser automation to use, a
 * setup phase, a restart, a task on the fixture app, and the harness's own
 * outcome check and score.
 *
 *   node src/run.ts --tool <playwright-cli|playwright-mcp|agent-browser>
 *                   [--ref <ref>] [--packed <dir>] [--out <dir>]
 *                   [--agent claude|none] [--keep]
 *
 * --agent none does the task with a script instead of a worker (see
 * selfCheck.ts), to check the harness without paying for a model.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { checkOutcome, startFixture } from "./fixture.ts";
import { DEFAULT_REF, pack, PACKAGES, type Packed } from "./pack.ts";
import { approveMcpJson, recorder, resultsDir } from "./paths.ts";
import { buildProject } from "./project.ts";
import { setupPrompt, taskPrompt, TOOLS, type Tool } from "./prompts.ts";
import { publish, startRegistry } from "./registry.ts";
import { scoreRun, table } from "./score.ts";
import { selfCheck } from "./selfCheck.ts";

const MODEL = "sonnet";
const EFFORT = "medium";
const SETUP_TIMEOUT_S = 720;
const TASK_TIMEOUT_S = 1200;
const ALLOWED_TOOLS =
  "Bash,Read,Write,Edit,Glob,Grep,Skill,ToolSearch,mcp__playwright,mcp__playwright-mcp,mcp__agent-browser,mcp__playwright-cli";

const { values } = parseArgs({
  options: {
    tool: { type: "string" },
    ref: { type: "string" },
    packed: { type: "string" },
    out: { type: "string" },
    agent: { type: "string", default: "claude" },
    keep: { type: "boolean", default: false },
  },
});
const tool = values.tool as Tool;
if (!TOOLS.includes(tool))
  throw new Error(`--tool must be one of ${TOOLS.join(", ")}`);
// Checked, because any other value would start a paid worker.
if (values.agent !== "claude" && values.agent !== "none")
  throw new Error("--agent must be claude or none");

// Only `claude` signs in, so no other process the harness starts gets the
// token: not the registry, npm or the self-check's browser.
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

const runId = `${tool}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const out = resolve(values.out ?? join(resultsDir, "runs", runId));
// An earlier run's files would be scored as this run's.
if (existsSync(out) && readdirSync(out).length > 0)
  throw new Error(`${out} is not empty; name a new folder`);
mkdirSync(out, { recursive: true });
const harnessLog = join(out, "harness.log");
const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  writeFileSync(harnessLog, `${stamped}\n`, { flag: "a" });
};

const packedArg = values.packed && resolve(values.packed);
const packed: Packed = packedArg
  ? (JSON.parse(readFileSync(join(packedArg, "meta.json"), "utf8")) as Packed)
  : pack(values.ref ?? DEFAULT_REF);
const packedDir = packedArg || packed.dir;

// Everything the worker sees lives outside the repo, so it finds no
// CLAUDE.md, skill or setting of this repo above its folder.
const work = mkdtempSync(join(tmpdir(), "eval-first-install-"));
const project = join(work, "project");
const n = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");

/** The worker's environment: the harness's own, without package-manager
 * leftovers, with the recorder loaded into every Node process. */
function workerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(npm_|pnpm_|PNPM_|COREPACK_|EVAL_FIRST_INSTALL_)/i.test(key))
      continue;
    env[key] = value;
  }
  env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${recorder}`]
    .filter(Boolean)
    .join(" ");
  env.EVAL_FIRST_INSTALL_RECORD = join(out, "ayme-record.jsonl");
  env.EVAL_FIRST_INSTALL_RUN = runId;
  return env;
}

/** Processes this run started: they carry the run's marker or name its folder. */
function runProcesses(): number[] {
  const marker = `EVAL_FIRST_INSTALL_RUN=${runId}`;
  const pids = new Set<number>();
  if (process.platform === "linux") {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const environ = readFileSync(`/proc/${entry}/environ`, "utf8");
        const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
        if (environ.includes(marker) || cmdline.includes(work))
          pids.add(Number(entry));
      } catch {
        // Gone, or not ours.
      }
    }
  } else {
    const listing = execFileSync("ps", ["-axwwE", "-o", "pid=,command="], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of listing.split("\n")) {
      if (line.includes(marker) || line.includes(work))
        pids.add(Number(line.trim().split(/\s+/)[0]));
    }
  }
  pids.delete(process.pid);
  return [...pids].filter((pid) => pid > 1);
}

async function stopRunProcesses(): Promise<number> {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of runProcesses()) {
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return runProcesses().length;
}

type Phase = { exit: number | null; timedOut: boolean; seconds: number };

function runClaude(
  name: "setup" | "task",
  prompt: string,
  extra: string[],
  workerEnv: NodeJS.ProcessEnv
): Promise<Phase> {
  // The recorder files each `ayme` command under the phase it ran in.
  const env = { ...workerEnv, EVAL_FIRST_INSTALL_PHASE: name };
  writeFileSync(join(out, `${name}-prompt.txt`), prompt);
  const args = [
    "-p",
    prompt,
    ...extra,
    "--model",
    MODEL,
    "--effort",
    EFFORT,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    "--verbose",
    // Answers yes when Claude Code asks to edit .mcp.json, as the user
    // would; see approve-mcp-json.mjs. Bash too: a worker that edits it with
    // sed is asked as well.
    "--settings",
    JSON.stringify({
      hooks: {
        PermissionRequest: [
          {
            matcher: "Write|Edit|Bash",
            hooks: [
              {
                type: "command",
                command: `node "${approveMcpJson}" "${join(out, "approvals.log")}"`,
              },
            ],
          },
        ],
      },
    }),
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ALLOWED_TOOLS,
    "--disallowedTools",
    "WebFetch,WebSearch,Agent,Task",
  ];
  const timeout = name === "setup" ? SETUP_TIMEOUT_S : TASK_TIMEOUT_S;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: project,
      env: token ? { ...env, CLAUDE_CODE_OAUTH_TOKEN: token } : env,
      stdio: [
        "ignore",
        openSync(join(out, `${name}.jsonl`), "w"),
        openSync(join(out, `${name}.err`), "w"),
      ],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout * 1000);
    child.on("exit", (exit) => {
      clearTimeout(timer);
      resolve({
        exit,
        timedOut,
        seconds: Math.round((Date.now() - started) / 1000),
      });
    });
  });
}

/** Why Claude Code answered without the model, such as a usage limit. */
function agentRefusal(file: string): string | undefined {
  if (!existsSync(file)) return "no transcript";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"<synthetic>"')) continue;
    const event = JSON.parse(line);
    return event.message?.content?.[0]?.text ?? "a synthetic answer";
  }
  return undefined;
}

function sessionId(): string | undefined {
  const file = join(out, "setup.jsonl");
  if (!existsSync(file)) return undefined;
  return /"session_id":"([^"]+)"/.exec(readFileSync(file, "utf8"))?.[1];
}

function copyWorkerFiles(): void {
  const configs = join(out, "configs");
  mkdirSync(configs, { recursive: true });
  for (const entry of readdirSync(project)) {
    if (
      entry.endsWith(".json") ||
      entry === "REPORT.md" ||
      entry === ".npmrc"
    ) {
      cpSync(
        join(project, entry),
        join(entry === "REPORT.md" ? out : configs, entry)
      );
    }
  }
  if (existsSync(join(project, ".mcp.json")))
    cpSync(join(project, ".mcp.json"), join(out, "mcp.json"));
  for (const dir of [".playwright", ".claude"]) {
    if (existsSync(join(project, dir))) {
      cpSync(join(project, dir), join(configs, dir), {
        recursive: true,
        filter: (source) => !source.includes(`${join(".claude", "skills")}`),
      });
    }
  }
}

const meta: Record<string, unknown> = {
  runId,
  tool,
  ref: packed.ref,
  sha: packed.sha,
  version: packed.version,
  n,
  agent: values.agent,
  model: MODEL,
  effort: EFFORT,
  platform: process.platform,
  startedAt: new Date().toISOString(),
};
const writeMeta = () =>
  writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

const registry = await startRegistry(
  join(work, "registry"),
  join(out, "registry.log"),
  PACKAGES.map((name) => `@ayme-dev/${name}`)
);
// The registry already runs, so a fixture that fails to start stops it.
const fixture = await startFixture().catch((error) => {
  registry.stop();
  throw error;
});
let exitCode = 0;
try {
  log(
    `Run ${runId}: ${packed.ref} at ${packed.sha.slice(0, 8)} as ${packed.version}; output in ${out}`
  );
  await publish(
    registry.url,
    packed.tarballs.map((t) => join(packedDir, "tarballs", t)),
    work
  );
  log(`Published to ${registry.url}`);

  buildProject(
    project,
    { dir: packedDir, version: packed.version },
    registry.url
  );
  const env = workerEnv();
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: project,
    env,
    stdio: "inherit",
  });
  log(`Installed the project in ${project}; the app runs at ${fixture.url}`);
  meta.page = fixture.url;
  meta.project = project;
  meta.registry = registry.url;
  if (values.agent === "claude") {
    meta.claudeVersion = execFileSync("claude", ["--version"], {
      encoding: "utf8",
    }).trim();
  }
  writeMeta();

  if (values.agent === "none") {
    meta.selfCheckCommands = await selfCheck(
      project,
      fixture.url,
      n,
      packed.version,
      { ...env, EVAL_FIRST_INSTALL_PHASE: "task" },
      log
    );
  } else {
    const setup = await runClaude(
      "setup",
      setupPrompt(tool, fixture.url),
      [],
      env
    );
    log(`setup: ${JSON.stringify(setup)}`);
    meta.setup = setup;
    const refused = agentRefusal(join(out, "setup.jsonl"));
    if (refused) throw new Error(`The model was never reached: ${refused}`);
    // The restart: the worker's own folder processes stay as a real user's
    // would, but the session ends and starts again with .mcp.json loaded.
    const id = sessionId();
    const mcp = existsSync(join(project, ".mcp.json"))
      ? ["--mcp-config", join(project, ".mcp.json")]
      : [];
    const task = await runClaude(
      "task",
      taskPrompt(tool, fixture.url, n),
      [...(id ? ["--resume", id] : []), ...mcp],
      env
    );
    log(`task: ${JSON.stringify(task)}`);
    meta.task = task;
    // A usage limit mid-task fails the harness, not the worker, as in setup.
    const taskRefused = agentRefusal(join(out, "task.jsonl"));
    if (taskRefused)
      throw new Error(`The model stopped answering: ${taskRefused}`);
  }
} catch (error) {
  exitCode = 1;
  meta.error = String((error as Error)?.stack ?? error);
  log(`Harness error: ${meta.error}`);
} finally {
  const outcome = checkOutcome(fixture.state(), n);
  if (meta.error) Object.assign(outcome, { harnessError: meta.error });
  writeFileSync(
    join(out, "outcome.json"),
    `${JSON.stringify({ ...outcome, state: fixture.state() }, null, 2)}\n`
  );
  writeFileSync(join(out, "fixture.log"), `${fixture.log().join("\n")}\n`);
  log(
    `Outcome: ${outcome.passed ? "passed" : "failed"} ${JSON.stringify(outcome.checks)}`
  );
  // A failed copy must not skip stopping the worker's processes below.
  try {
    if (existsSync(project)) copyWorkerFiles();
  } catch (error) {
    log(`Copying the worker's files failed: ${String(error)}`);
  }
  meta.leftRunning = await stopRunProcesses();
  await fixture.close();
  registry.stop();
  meta.finishedAt = new Date().toISOString();
  writeMeta();
  const score = scoreRun(out);
  writeFileSync(join(out, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
  writeFileSync(join(out, "score.md"), table([score]));
  console.log(table([score]));
  if (!values.keep) rmSync(work, { recursive: true, force: true });
  else log(`Kept ${work}`);
  if (values.agent === "none") {
    // The self-check also proves the recorder saw every command it ran.
    const recorded = Object.values(score.aymeCommands?.task ?? {}).reduce(
      (sum, { count }) => sum + count,
      0
    );
    if (recorded !== meta.selfCheckCommands)
      log(
        `The recording holds ${recorded} ayme commands; the self-check ran ${String(meta.selfCheckCommands)}`
      );
    if (!outcome.passed || recorded !== meta.selfCheckCommands) exitCode = 1;
  }
}
process.exit(exitCode);
