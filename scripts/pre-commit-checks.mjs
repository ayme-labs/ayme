/**
 * Runs the pre-commit hook's typecheck or test job on the workspaces the
 * staged change reaches: those it touches and those depending on them.
 * Unstaged and untracked files never widen the selection. Why the hook stays
 * small: docs/testing.md#local-runs-and-ci.
 *
 *   node scripts/pre-commit-checks.mjs typecheck|test          run the task
 *   node scripts/pre-commit-checks.mjs typecheck|test --dry    print it only
 *
 * The typecheck job, which runs first, prints the notices; both jobs print
 * the skip when the selection is over the cap.
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Above this many test tasks, both jobs leave the selection to CI. */
export const TEST_TASK_CAP = 4;

/** Root files every workspace depends on. */
export const GLOBAL_FILES = new Set([
  "turbo.json",
  "playwright-range.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

/** Their typecheck needs an uncached production build. */
export const HEAVY_APPS = ["@ayme-dev/example-next", "@ayme-dev/example-nuxt"];

const QUICKSTART = /^docs\/guide\/start\/quickstart-[^/]*\.md$/;
const WORKSPACE_DIR = /^(?:packages|apps)\/[^/]+(?=\/.)/;
const POLICY = "docs/testing.md#local-runs-and-ci";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the staged paths reach. `workspaces` are the current workspace
 * directories; `removed` lists those directories of staged paths that are no
 * longer a workspace, for the caller to check against HEAD.
 */
export function planSelection(staged, workspaces) {
  const current = new Set(workspaces);
  const selected = new Set();
  const removed = new Set();
  let all = false;
  let quickstart = false;
  for (const file of staged) {
    if (GLOBAL_FILES.has(file)) all = true;
    if (QUICKSTART.test(file)) quickstart = true;
    const dir = WORKSPACE_DIR.exec(file)?.[0];
    if (dir === undefined) continue;
    if (current.has(dir)) selected.add(dir);
    else removed.add(dir);
  }
  return {
    all,
    workspaces: all ? [] : [...selected].sort(),
    removed: [...removed].sort(),
    quickstart,
  };
}

/** Turbo filters for a plan, or undefined when it selects nothing. */
export function filtersFor(plan) {
  if (!plan.all && plan.workspaces.length === 0) return undefined;
  const selection = plan.workspaces.map((dir) => `--filter=...{./${dir}}`);
  return {
    selection,
    run: [...selection, ...HEAVY_APPS.map((name) => `--filter=!${name}`)],
  };
}

/** The test tasks Turbo would run, from `turbo run test --dry=json`. */
export function countTestTasks(dryRunJson) {
  const { tasks } = JSON.parse(dryRunJson);
  if (!Array.isArray(tasks)) {
    throw new Error("turbo --dry=json printed no tasks array");
  }
  return tasks.filter(
    (task) => task.task === "test" && task.command !== "<NONEXISTENT>"
  ).length;
}

export function skipMessage(count) {
  return `${count} test tasks: leaving them to CI. CI skips draft pull requests, so mark the PR ready. See ${POLICY}.`;
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// The local binary, not `pnpm exec`: pnpm may install first and print to
// stdout, which Turbo's JSON goes to.
const TURBO = path.join(ROOT, "node_modules", ".bin", "turbo");

function turbo(...args) {
  return run(TURBO, args);
}

function packageNames(lsJson) {
  const { packages } = JSON.parse(lsJson);
  if (!Array.isArray(packages?.items)) {
    throw new Error("turbo ls --output=json printed no packages");
  }
  return packages.items;
}

/** Whether HEAD has `dir` as a workspace, that is, the change deletes it. */
function wasWorkspace(dir) {
  const result = spawnSync(
    "git",
    ["cat-file", "-e", `HEAD:${dir}/package.json`],
    { cwd: ROOT, stdio: "ignore" }
  );
  if (result.error) throw result.error;
  return result.status === 0;
}

function main() {
  const [task, ...flags] = process.argv.slice(2);
  if (task !== "typecheck" && task !== "test") {
    throw new Error("Usage: pre-commit-checks.mjs typecheck|test [--dry]");
  }
  const dry = flags.includes("--dry");
  const notify = task === "typecheck";

  const staged = run("git", [
    "diff",
    "--cached",
    "--name-only",
    "--no-renames",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
  const workspaces = packageNames(turbo("ls", "--output=json"));
  const plan = planSelection(
    staged,
    workspaces.map((workspace) => workspace.path)
  );

  if (notify) {
    for (const dir of plan.removed.filter(wasWorkspace)) {
      console.log(`${dir} is deleted; CI checks it.`);
    }
    if (plan.quickstart) {
      console.log(
        "A quickstart changed. Its check, the packed-consumer test in packages/ayme, is heavy and left to CI; run it alone with `pnpm -C packages/ayme test:package`."
      );
    }
  }

  const filters = filtersFor(plan);
  if (filters === undefined) return;

  if (notify) {
    const selected = new Set(
      packageNames(turbo("ls", ...filters.selection, "--output=json")).map(
        (workspace) => workspace.name
      )
    );
    const heavy = HEAVY_APPS.filter((name) => selected.has(name));
    if (heavy.length > 0) {
      console.log(
        `Left to CI, since their typecheck needs a production build: ${heavy.join(", ")}.`
      );
    }
  }

  const count = countTestTasks(
    turbo("run", "test", ...filters.run, "--dry=json")
  );
  if (count > TEST_TASK_CAP) {
    console.log(skipMessage(count));
    return;
  }

  const args = ["run", task, ...filters.run, "--concurrency=50%"];
  if (dry) {
    console.log(`turbo ${args.join(" ")}`);
    return;
  }
  const result = spawnSync(TURBO, args, {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
