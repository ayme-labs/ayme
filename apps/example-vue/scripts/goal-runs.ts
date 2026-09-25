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

import type { GoalRunRecord, GoalRunStep } from "../tests/goalRunRecord";
import { appRoot, goalRunsVariable, readModelKey } from "./appEnvironment.ts";

const outputDirectory = path.join(appRoot, "goal-runs");

/**
 * Question-id and option-key conventions of the chunked ref questions in
 * `packages/webmcp/src/goalLoopQuestions.ts`: a run-off's question id ends
 * with `run_off`, and a chunk's "none of these" option is `none_of_these`.
 */
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
  /** Steps that asked a run-off because several chunks each named an element. */
  chunkConflicts: number;
  /** Chunk questions answered "none of these". */
  noneOfTheseAnswers: number;
  /** The first line of the test's error, when it failed. */
  error?: string;
  /** Why the recorder could not record the whole run. */
  recorderError?: string;
};

type GoalAggregate = {
  runs: number;
  passRate: number;
  meanSteps: number;
  maxSteps: number;
  meanModelCallsPerStep: number;
  meanWallTimeMs: number;
  reasons: Record<string, number>;
  chunkConflicts: number;
  noneOfTheseAnswers: number;
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

// --- Shared formatting ---

function format(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function commitLabel(commit: GoalRunsFile["commit"]) {
  return `${commit.sha.slice(0, 7)}${commit.dirty ? " (dirty)" : ""}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

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

function toGoalRun(testResult: ReportResult): {
  goal: string | null;
  models: string[];
  run: GoalRun;
} {
  const attachment = testResult.attachments.find(
    (candidate) => candidate.name === "goal-run" && candidate.body
  );
  const record = attachment
    ? (JSON.parse(
        Buffer.from(attachment.body!, "base64").toString("utf8")
      ) as GoalRunRecord)
    : undefined;
  const steps = record?.steps ?? [];
  const choices = steps.flatMap((step) =>
    step.argumentChoices ? [step.argumentChoices] : []
  );
  const run: GoalRun = {
    passed: testResult.status === "passed",
    reason: record?.reason ?? null,
    stepCount: steps.length,
    wallTimeMs: record?.wallTimeMs ?? Math.round(testResult.duration),
    steps,
    chunkConflicts: choices.filter((stepChoices) =>
      Object.keys(stepChoices).some((id) => id.endsWith(runOffSuffix))
    ).length,
    noneOfTheseAnswers: choices
      .flatMap(Object.values)
      .filter((key) => key === noneOfTheseKey).length,
  };
  if (testResult.error?.message)
    run.error = firstLine(testResult.error.message);
  if (record?.recorderError) run.recorderError = record.recorderError;
  return { goal: record?.goal ?? null, models: record?.models ?? [], run };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) =>
  values.length === 0 ? 0 : sum(values) / values.length;

function aggregate(runs: GoalRun[]): GoalAggregate {
  const stepCounts = runs.map((run) => run.stepCount);
  const reasons: Record<string, number> = {};
  for (const run of runs) {
    const reason = run.reason ?? "no_handover";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const totalSteps = sum(stepCounts);
  const totalCalls = sum(
    runs.flatMap((run) => run.steps.map((step) => step.modelCalls))
  );
  return {
    runs: runs.length,
    passRate: runs.filter((run) => run.passed).length / runs.length,
    meanSteps: mean(stepCounts),
    maxSteps: Math.max(0, ...stepCounts),
    meanModelCallsPerStep: totalSteps === 0 ? 0 : totalCalls / totalSteps,
    meanWallTimeMs: Math.round(mean(runs.map((run) => run.wallTimeMs))),
    reasons,
    chunkConflicts: sum(runs.map((run) => run.chunkConflicts)),
    noneOfTheseAnswers: sum(runs.map((run) => run.noneOfTheseAnswers)),
  };
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
  if (!readModelKey())
    fail(
      "Set AYME_OPENROUTER_API_KEY to your own model key: without it the live goals skip and there is nothing to record."
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
      "playwright.goals.config.ts",
      `--repeat-each=${runsPerGoal}`,
      "--retries=0",
      "--reporter=list,json",
    ],
    { PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile, [goalRunsVariable]: "1" }
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
    `\nGoal runs: ${runsPerGoal} per goal, model ${runsFile.model}, commit ${commitLabel(runsFile.commit)}`
  );
  for (const [title, { aggregate: summary }] of Object.entries(runsFile.goals))
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

function delta(before: number | undefined, after: number | undefined) {
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
      `${label}: ${file}\n   commit ${commitLabel(runs.commit)}, model ${runs.model}, ${runs.runsPerGoal} runs per goal, ${runs.timestamp}`
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
