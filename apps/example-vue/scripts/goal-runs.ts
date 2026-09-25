/**
 * The Goal Loop run harness (#121): runs the live lane's goals N times each
 * against the real Decision Endpoint and writes one JSON file per invocation,
 * or compares two such files. Run by hand only; see the README.
 *
 *   node scripts/goal-runs.ts --runs <N>
 *   node scripts/goal-runs.ts compare <runA.json> <runB.json>
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";

import type { GoalRunRecord, GoalRunStep } from "../tests/goalRunRecord";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const outputDirectory = path.join(appRoot, "goal-runs");

/** Question-id and option-key conventions of the chunked ref questions (#123). */
const runOffSuffix = "run_off";
const noneOfTheseKey = "none_of_these";

type GoalRun = {
  /** The test's expectations held: the goal's expected outcome was reached. */
  passed: boolean;
  /** The Handover reason; null when the run failed before `pursue_goal` returned. */
  reason: string | null;
  stepCount: number;
  wallTimeMs: number;
  steps: GoalRunStep[];
  /** Only when the loop records `argumentChoices`. */
  chunkConflicts?: number;
  noneOfTheseAnswers?: number;
  /** The first line of the test's error, when it failed. */
  error?: string;
};

type GoalAggregate = {
  runs: number;
  passRate: number;
  meanSteps: number;
  maxSteps: number;
  meanModelCallsPerStep: number;
  meanWallTimeMs: number;
  reasons: Record<string, number>;
  /** Null when no run of the goal recorded `argumentChoices`. */
  chunkConflicts: number | null;
  noneOfTheseAnswers: number | null;
};

type GoalRunsFile = {
  commit: { sha: string; dirty: boolean };
  model: string | null;
  runsPerGoal: number;
  timestamp: string;
  goals: Record<
    string,
    { goal: string | null; aggregate: GoalAggregate; runs: GoalRun[] }
  >;
};

// --- The Playwright JSON report, as far as this script reads it ---

type ReportResult = {
  status: string;
  duration: number;
  error?: { message?: string };
  attachments: { name: string; body?: string }[];
};
type ReportSpec = { title: string; tests: { results: ReportResult[] }[] };
type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] };

function specsOf(suite: ReportSuite): ReportSpec[] {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specsOf)];
}

// eslint-disable-next-line no-control-regex
const terminalColour = /\u001b\[[0-9;]*m/g;

function firstLine(text: string) {
  return text.replace(terminalColour, "").split("\n")[0]!.trim();
}

function toGoalRun(result: ReportResult): {
  goal: string | null;
  models: string[];
  run: GoalRun;
} {
  const attachment = result.attachments.find(
    (candidate) => candidate.name === "goal-run" && candidate.body
  );
  const record = attachment
    ? (JSON.parse(
        Buffer.from(attachment.body!, "base64").toString("utf8")
      ) as GoalRunRecord)
    : undefined;
  const steps = record?.steps ?? [];
  const run: GoalRun = {
    passed: result.status === "passed",
    reason: record?.reason ?? null,
    stepCount: steps.length,
    wallTimeMs: record?.wallTimeMs ?? Math.round(result.duration),
    steps,
  };
  const choices = steps.flatMap((step) =>
    step.argumentChoices ? [step.argumentChoices] : []
  );
  if (choices.length > 0) {
    run.chunkConflicts = choices.filter((stepChoices) =>
      Object.keys(stepChoices).some((id) => id.endsWith(runOffSuffix))
    ).length;
    run.noneOfTheseAnswers = choices
      .flatMap(Object.values)
      .filter((key) => key === noneOfTheseKey).length;
  }
  if (result.error?.message) run.error = firstLine(result.error.message);
  return { goal: record?.goal ?? null, models: record?.models ?? [], run };
}

const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

function sumOrNull(values: (number | undefined)[]) {
  const present = values.filter((value) => value !== undefined);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

function aggregate(runs: GoalRun[]): GoalAggregate {
  const stepCounts = runs.map((run) => run.stepCount);
  const reasons: Record<string, number> = {};
  for (const run of runs) {
    const reason = run.reason ?? "no_handover";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const totalSteps = stepCounts.reduce((a, b) => a + b, 0);
  const totalCalls = runs
    .flatMap((run) => run.steps)
    .reduce((sum, step) => sum + step.modelCalls, 0);
  return {
    runs: runs.length,
    passRate: runs.filter((run) => run.passed).length / runs.length,
    meanSteps: mean(stepCounts),
    maxSteps: Math.max(0, ...stepCounts),
    meanModelCallsPerStep: totalSteps === 0 ? 0 : totalCalls / totalSteps,
    meanWallTimeMs: Math.round(mean(runs.map((run) => run.wallTimeMs))),
    reasons,
    chunkConflicts: sumOrNull(runs.map((run) => run.chunkConflicts)),
    noneOfTheseAnswers: sumOrNull(runs.map((run) => run.noneOfTheseAnswers)),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  }).status;
}

function readRunsArgument(args: string[]) {
  const index = args.indexOf("--runs");
  const value = index >= 0 ? args[index + 1] : undefined;
  const runs = Number(value);
  if (!Number.isInteger(runs) || runs < 1)
    fail(
      "Pass the number of runs per goal, e.g. --runs 3. Every run makes real model calls."
    );
  return runs;
}

function runGoals(runsPerGoal: number) {
  if (!loadEnv("development", appRoot, "").AYME_OPENROUTER_API_KEY)
    fail(
      "Set AYME_OPENROUTER_API_KEY to your own model key: without it the live goals skip and there is nothing to record."
    );

  // The dev server needs the workspace packages built, as `test:goals` does.
  if (
    run("pnpm", [
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
  run(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.goals.config.ts",
      `--repeat-each=${runsPerGoal}`,
      "--retries=0",
      "--reporter=list,json",
    ],
    { PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile }
  );
  if (!fs.existsSync(reportFile)) fail("Playwright wrote no report.");

  const report = JSON.parse(fs.readFileSync(reportFile, "utf8")) as ReportSuite;
  const byTitle = new Map<string, { goal: string | null; runs: GoalRun[] }>();
  const models = new Set<string>();
  // With --repeat-each, every repeat is a spec of its own with the same title.
  for (const spec of specsOf(report)) {
    const result = spec.tests[0]?.results.at(-1);
    if (!result || result.status === "skipped") continue;
    const parsed = toGoalRun(result);
    parsed.models.forEach((model) => models.add(model));
    const entry = byTitle.get(spec.title) ?? { goal: parsed.goal, runs: [] };
    entry.goal ??= parsed.goal;
    entry.runs.push(parsed.run);
    byTitle.set(spec.title, entry);
  }
  if (byTitle.size === 0) fail("No goal ran; see the Playwright output above.");

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: appRoot, encoding: "utf8" }).trim();
  const result: GoalRunsFile = {
    commit: {
      sha: git("rev-parse", "HEAD"),
      dirty: git("status", "--porcelain").length > 0,
    },
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
    `${result.timestamp.replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

  console.log(
    `\nGoal runs: ${runsPerGoal} per goal, model ${result.model}, commit ${result.commit.sha.slice(0, 7)}${result.commit.dirty ? " (dirty)" : ""}`
  );
  for (const [title, { aggregate: summary }] of Object.entries(result.goals))
    console.log(
      `  ${title}\n    pass rate ${format(summary.passRate)}, steps mean ${format(summary.meanSteps)} max ${summary.maxSteps}, model calls per step ${format(summary.meanModelCallsPerStep)}, reasons ${JSON.stringify(summary.reasons)}`
    );
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

// --- compare ---

const comparedFields = [
  "passRate",
  "meanSteps",
  "maxSteps",
  "meanModelCallsPerStep",
  "meanWallTimeMs",
  "chunkConflicts",
  "noneOfTheseAnswers",
] as const;

function format(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function delta(before: number | null | undefined, after: number | null) {
  if (typeof before !== "number" || after === null) return "";
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
      `${label}: ${file}\n   commit ${runs.commit.sha.slice(0, 7)}${runs.commit.dirty ? " (dirty)" : ""}, model ${runs.model}, ${runs.runsPerGoal} runs per goal, ${runs.timestamp}`
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
        `  ${field.padEnd(22)}${format(valueA).padStart(8)} -> ${format(valueB).padEnd(8)}${delta(valueA, valueB)}`.trimEnd()
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
  runGoals(readRunsArgument(args));
}
