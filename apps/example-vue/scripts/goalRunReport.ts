/**
 * The pure half of the run harness: a Playwright test result with its
 * `goal-run` attachment becomes a run, and runs become a goal's aggregate.
 */
import type { GoalRunRecord, GoalRunStep } from "../tests/goalRunRecord";
/** A chunk's "none of these" option key, as `NONE_OF_THESE_KEY` in
 *  `packages/webmcp/src/goalLoopQuestions.ts`. */
const noneOfTheseKey = "none_of_these";

export type GoalRun = {
  /** The test's expectations held: the goal's expected outcome was reached. */
  passed: boolean;
  /** The Handover reason; null when the run failed before `pursue_goal` returned. */
  reason: string | null;
  stepCount: number;
  wallTimeMs: number;
  steps: GoalRunStep[];
  /** Steps that requested a run-off because several chunks each named an element. */
  chunkConflicts: number;
  /** Chunk questions answered "none of these". */
  noneOfTheseAnswers: number;
  /** The first line of the test's error, when it failed. */
  error?: string;
  /** Why the recorder could not record the whole run. */
  recorderError?: string;
};

export type GoalAggregate = {
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

// --- The Playwright JSON report, as far as this script reads it ---

export type ReportResult = {
  status: string;
  duration: number;
  error?: { message?: string };
  attachments: { name: string; body?: string }[];
};
export type ReportSpec = {
  title: string;
  tests: { results: ReportResult[] }[];
};
export type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] };

export function specsOf(suite: ReportSuite): ReportSpec[] {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specsOf)];
}

// eslint-disable-next-line no-control-regex
const terminalColour = /\u001b\[[0-9;]*m/g;

function firstLine(text: string) {
  return text.replace(terminalColour, "").split("\n")[0]!.trim();
}

export function toGoalRun(testResult: ReportResult): {
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
    chunkConflicts: steps.filter((step) => step.runOff).length,
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

export function aggregate(runs: GoalRun[]): GoalAggregate {
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
