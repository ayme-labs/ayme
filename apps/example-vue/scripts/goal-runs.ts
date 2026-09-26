/**
 * The Goal Loop run harness (#121): runs a goal set N times per goal against
 * the real Decision Endpoint and writes one JSON file per invocation, or
 * compares two such files. Run by hand only; see the README.
 *
 *   node scripts/goal-runs.ts --runs <N> [--variant last-step] [--live-lane]
 *   node scripts/goal-runs.ts compare <runA.json> <runB.json>
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appRoot, goalRunsVariable, readModelKey } from "./appEnvironment.ts";
import {
  aggregate,
  specsOf,
  toGoalRun,
  type GoalAggregate,
  type GoalRun,
  type ReportSuite,
} from "./goalRunReport.ts";

const outputDirectory = path.join(appRoot, "goal-runs");

/** The goal sets: the harness's own by default, the live lane on request. */
const goalSets = {
  harness: "playwright.harness.config.ts",
  "live-lane": "playwright.goals.config.ts",
} as const;
type GoalSet = keyof typeof goalSets;

/**
 * The Goal Loop's experiment switch for #173 (see `goalLoop.ts`) and the one
 * value it knows; the dev server hands it to the page.
 */
const historyChangesVariable = "AYME_GOAL_LOOP_HISTORY_CHANGES";
const variants = ["last-step"];

type GoalRunsFile = {
  commit: { sha: string; dirty: boolean };
  goalSet: GoalSet;
  /** The experiment variant the runs used; null for the loop as it is. */
  variant: string | null;
  model: string | null;
  runsPerGoal: number;
  timestamp: string;
  goals: Record<
    string,
    { goal: string | null; aggregate: GoalAggregate; runs: GoalRun[] }
  >;
};

// --- Shared formatting ---

function format(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function commitLabel(commit: GoalRunsFile["commit"]) {
  return `${commit.sha.slice(0, 7)}${commit.dirty ? " (dirty)" : ""}`;
}

/** Files written before the goal set and variant were recorded lack them. */
function runLabel(runs: GoalRunsFile) {
  return `${runs.runsPerGoal} runs per goal, goal set ${runs.goalSet ?? "live-lane"}, variant ${runs.variant ?? "none"}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// --- goal runs ---

/** Spawn a command in this app's directory; returns its exit status. */
function spawnInApp(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  }).status;
}

function optionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRunsArguments(args: string[]) {
  const runs = Number(optionValue(args, "--runs"));
  if (!Number.isInteger(runs) || runs < 1)
    fail(
      "Pass the number of runs per goal, e.g. --runs 3. Every run makes real model calls."
    );
  const variant = optionValue(args, "--variant") ?? null;
  if (args.includes("--variant") && !variants.includes(variant ?? ""))
    fail(`--variant takes one of: ${variants.join(", ")}.`);
  const goalSet: GoalSet = args.includes("--live-lane")
    ? "live-lane"
    : "harness";
  return { runsPerGoal: runs, variant, goalSet };
}

function runGoals({
  runsPerGoal,
  variant,
  goalSet,
}: ReturnType<typeof readRunsArguments>) {
  if (!readModelKey())
    fail(
      "Set AYME_OPENROUTER_API_KEY to your own model key: without it the goals skip and there is nothing to record."
    );

  // The dev server needs the workspace packages built, as `test:goals` does.
  if (
    spawnInApp("pnpm", [
      "--workspace-root",
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@ayme-dev/example-vue^...",
    ]) !== 0
  )
    fail("Building the workspace packages failed.");

  const reportFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "goal-runs-")),
    "report.json"
  );
  // Every repeat is one run; a failed run is data, so there are no retries
  // and a non-zero exit is expected whenever a run fails.
  spawnInApp(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      goalSets[goalSet],
      `--repeat-each=${runsPerGoal}`,
      "--retries=0",
      "--reporter=list,json",
    ],
    {
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      [goalRunsVariable]: "1",
      // Set or cleared, so the variant a file records is the one that ran.
      [historyChangesVariable]: variant ?? "",
    }
  );
  if (!fs.existsSync(reportFile)) fail("Playwright wrote no report.");

  const report = JSON.parse(fs.readFileSync(reportFile, "utf8")) as ReportSuite;
  const byTitle = new Map<string, { goal: string | null; runs: GoalRun[] }>();
  const models = new Set<string>();
  // With --repeat-each, every repeat is a spec of its own with the same title.
  for (const spec of specsOf(report)) {
    const testResult = spec.tests[0]?.results.at(-1);
    if (!testResult || testResult.status === "skipped") continue;
    const parsed = toGoalRun(testResult);
    parsed.models.forEach((model) => models.add(model));
    const entry = byTitle.get(spec.title) ?? { goal: parsed.goal, runs: [] };
    entry.goal ??= parsed.goal;
    entry.runs.push(parsed.run);
    byTitle.set(spec.title, entry);
  }
  if (byTitle.size === 0) fail("No goal ran; see the Playwright output above.");

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: appRoot, encoding: "utf8" }).trim();
  const runsFile: GoalRunsFile = {
    commit: {
      sha: git("rev-parse", "HEAD"),
      dirty: git("status", "--porcelain").length > 0,
    },
    goalSet,
    variant,
    model: models.size === 0 ? null : [...models].join(", "),
    runsPerGoal,
    timestamp: new Date().toISOString(),
    goals: Object.fromEntries(
      [...byTitle].map(([title, entry]) => [
        title,
        {
          goal: entry.goal,
          aggregate: aggregate(entry.runs),
          runs: entry.runs,
        },
      ])
    ),
  };

  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(
    outputDirectory,
    `${runsFile.timestamp.replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(file, `${JSON.stringify(runsFile, null, 2)}\n`);

  console.log(
    `\nGoal runs: ${runLabel(runsFile)}, model ${runsFile.model}, commit ${commitLabel(runsFile.commit)}`
  );
  for (const [title, { aggregate: summary }] of Object.entries(runsFile.goals))
    console.log(
      `  ${title}\n    pass rate ${format(summary.passRate)}, done at expected step ${format(summary.doneAtExpectedStepRate)}, steps mean ${format(summary.meanSteps)} max ${summary.maxSteps}, model calls per step ${format(summary.meanModelCallsPerStep)}, page bytes per step ${format(summary.meanPageBytesPerStep)}, reasons ${JSON.stringify(summary.reasons)}`
    );
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

// --- compare ---

const comparedFields = [
  "passRate",
  "doneAtExpectedStepRate",
  "noFittingOptionRate",
  "meanSteps",
  "maxSteps",
  "meanModelCallsPerStep",
  "meanPageBytesPerStep",
  "meanHistoryBytesPerStep",
  "meanWallTimeMs",
  "chunkConflicts",
  "noneOfTheseAnswers",
] as const;

function delta(
  before: number | null | undefined,
  after: number | null | undefined
) {
  if (typeof before !== "number" || typeof after !== "number") return "";
  const difference = after - before;
  return difference === 0
    ? ""
    : `  (${difference > 0 ? "+" : ""}${format(difference)})`;
}

function readRunsFile(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as GoalRunsFile;
  } catch (error) {
    fail(`Could not read ${file}: ${(error as Error).message}`);
  }
}

function compare(fileA: string, fileB: string) {
  const [a, b] = [readRunsFile(fileA), readRunsFile(fileB)];
  for (const [label, file, runs] of [
    ["A", fileA, a],
    ["B", fileB, b],
  ] as const)
    console.log(
      `${label}: ${file}\n   commit ${commitLabel(runs.commit)}, model ${runs.model}, ${runLabel(runs)}, ${runs.timestamp}`
    );

  const titles = [
    ...new Set([...Object.keys(a.goals), ...Object.keys(b.goals)]),
  ];
  const passRateChanged: string[] = [];
  for (const title of titles) {
    const [before, after] = [a.goals[title], b.goals[title]];
    console.log(`\n${title}`);
    if (!before || !after) {
      console.log(`  only in ${before ? "A" : "B"}`);
      continue;
    }
    for (const field of comparedFields) {
      const [valueA, valueB] = [
        before.aggregate[field],
        after.aggregate[field],
      ];
      console.log(
        `  ${field.padEnd(24)}${format(valueA).padStart(8)} -> ${format(valueB).padEnd(8)}${delta(valueA, valueB)}`.trimEnd()
      );
    }
    if (before.aggregate.passRate !== after.aggregate.passRate)
      passRateChanged.push(
        `  ${title}: ${format(before.aggregate.passRate)} -> ${format(after.aggregate.passRate)}`
      );
  }
  console.log(
    `\nPass rate changed:\n${passRateChanged.length > 0 ? passRateChanged.join("\n") : "  none"}`
  );
}

// --- entry point ---

const args = process.argv.slice(2);
if (args[0] === "compare") {
  if (args.length !== 3)
    fail("Usage: goals:runs compare <runA.json> <runB.json>");
  compare(args[1]!, args[2]!);
} else {
  runGoals(readRunsArguments(args));
}
