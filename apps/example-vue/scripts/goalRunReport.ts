/**
 * The pure half of the run harness: a Playwright test result with its
 * `goal-run` attachment becomes a run, and runs become a goal's aggregate.
 */
import type { GoalRunRecord, GoalRunStep } from "../tests/goalRunRecord";
/** A chunk's "none of these" option key, as `NONE_OF_THESE_KEY` in
 *  `packages/ayme/src/goalLoopQuestions.ts`. */
const noneOfTheseKey = "none_of_these";

export type GoalRun = {
  /** The test's expectations held: the goal's expected outcome was reached. */
  passed: boolean;
  /** The Handover reason; null when the run failed before `goal` returned. */
  reason: string | null;
  stepCount: number;
  /** The run ended `done` at the step count its test expects; absent when the
   *  test states none. */
  doneAtExpectedStep?: boolean;
  wallTimeMs: number;
  steps: GoalRunStep[];
  /** Steps that requested a run-off because several chunks each named an element. */
  chunkConflicts: number;
  /** Chunk questions answered "none of these". */
  noneOfTheseAnswers: number;
  /** Steps that ran the same operation with the same argument choices as the
   *  step before them. */
  repeatedSteps: number;
  /**
   * `fill` or `type` steps of a Goal Value whose expected element the test
   * states, which targeted another element; absent when the test states none.
   */
  wrongTargetSteps?: number;
  /** Tokens the run's calls used, over the calls whose response reported
   *  usage; null when none did. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** The first line of the test's error, when it failed. */
  error?: string;
  /** Why the recorder could not record the whole run. */
  recorderError?: string;
};

export type GoalAggregate = {
  runs: number;
  passRate: number;
  /** Null when the goal's test states no expected step count. */
  doneAtExpectedStepRate: number | null;
  noFittingOptionRate: number;
  meanSteps: number;
  maxSteps: number;
  meanModelCallsPerStep: number;
  meanPageBytesPerStep: number;
  meanHistoryBytesPerStep: number;
  meanWallTimeMs: number;
  reasons: Record<string, number>;
  chunkConflicts: number;
  noneOfTheseAnswers: number;
  repeatedSteps: number;
  /** Null when the goal's test states no expected targets. */
  wrongTargetSteps: number | null;
  /** Over the steps whose calls reported token usage; null when none did. */
  meanInputTokensPerStep: number | null;
  meanOutputTokensPerStep: number | null;
  /** Input and output tokens, over the runs whose calls reported usage. */
  meanTokensPerRun: number | null;
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

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) =>
  values.length === 0 ? 0 : sum(values) / values.length;

/** Handover reasons after which the last step ran its operation; after any
 *  other, the last step ended the run before acting. */
const lastStepActed = new Set(["step_budget", "action_failed", "page_loading"]);

/** The steps of a run that ran their operation. */
function actedSteps(steps: GoalRunStep[], reason: string | null) {
  return reason !== null && lastStepActed.has(reason)
    ? steps
    : steps.slice(0, -1);
}

const sameChoices = (a: GoalRunStep, b: GoalRunStep) =>
  a.operation === b.operation &&
  JSON.stringify(Object.entries(a.argumentChoices ?? {}).sort()) ===
    JSON.stringify(Object.entries(b.argumentChoices ?? {}).sort());

/** Steps that ran what the step before them ran, choice for choice. */
function countRepeatedSteps(steps: GoalRunStep[], reason: string | null) {
  return actedSteps(steps, reason).filter(
    (step, index, acted) => index > 0 && sameChoices(step, acted[index - 1]!)
  ).length;
}

/** The parameter every single-element Browser Tool targets with. */
const targetParameter = "target";

/**
 * The element a step's target question chose, as offered: the run-off's
 * choice when there was one, else the question, or the one chunk, that named
 * an element.
 */
function chosenTarget(step: GoalRunStep): string | undefined {
  const named = Object.entries(step.argumentDescriptions ?? {}).filter(
    ([id]) =>
      (id === targetParameter || id.startsWith(`${targetParameter}_`)) &&
      step.argumentChoices?.[id] !== noneOfTheseKey
  );
  return (named.find(([id]) => id.endsWith("run_off")) ?? named[0])?.[1];
}

/** The text-entering Browser Tools; their Goal Value is the `text` argument. */
const textOperations = new Set(["fill", "type"]);

function countWrongTargetSteps(
  steps: GoalRunStep[],
  expectedTargets: Record<string, string>
) {
  return steps.filter((step) => {
    if (!step.operation || !textOperations.has(step.operation)) return false;
    const label = step.argumentChoices?.text;
    const expected = label === undefined ? undefined : expectedTargets[label];
    return expected !== undefined && chosenTarget(step) !== expected;
  }).length;
}

/** The sum of a token field over the steps that report it; null when none do. */
function tokens(
  steps: GoalRunStep[],
  field: "inputTokens" | "outputTokens"
): number | null {
  const reported = steps.flatMap((step) =>
    step[field] === undefined ? [] : [step[field]]
  );
  return reported.length === 0 ? null : sum(reported);
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
    repeatedSteps: countRepeatedSteps(steps, record?.reason ?? null),
    inputTokens: tokens(steps, "inputTokens"),
    outputTokens: tokens(steps, "outputTokens"),
  };
  if (record?.expectedTargets)
    run.wrongTargetSteps = countWrongTargetSteps(steps, record.expectedTargets);
  if (record?.expectedSteps !== undefined)
    run.doneAtExpectedStep =
      run.reason === "done" && run.stepCount === record.expectedSteps;
  if (testResult.error?.message)
    run.error = firstLine(testResult.error.message);
  if (record?.recorderError) run.recorderError = record.recorderError;
  return { goal: record?.goal ?? null, models: record?.models ?? [], run };
}

export function aggregate(runs: GoalRun[]): GoalAggregate {
  const stepCounts = runs.map((run) => run.stepCount);
  const reasons: Record<string, number> = {};
  for (const run of runs) {
    const reason = run.reason ?? "no_handover";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const steps = runs.flatMap((run) => run.steps);
  const perStep = (value: (step: GoalRunStep) => number) =>
    mean(steps.map(value));
  const rate = (count: number) => count / runs.length;
  const expecting = runs.filter((run) => run.doneAtExpectedStep !== undefined);
  const targeted = runs.flatMap((run) =>
    run.wrongTargetSteps === undefined ? [] : [run.wrongTargetSteps]
  );
  const reported = (field: "inputTokens" | "outputTokens") =>
    steps.flatMap((step) => (step[field] === undefined ? [] : [step[field]]));
  const meanOrNull = (values: number[]) =>
    values.length === 0 ? null : mean(values);
  return {
    runs: runs.length,
    passRate: rate(runs.filter((run) => run.passed).length),
    doneAtExpectedStepRate:
      expecting.length === 0
        ? null
        : rate(expecting.filter((run) => run.doneAtExpectedStep).length),
    noFittingOptionRate: rate(reasons.no_fitting_option ?? 0),
    meanSteps: mean(stepCounts),
    maxSteps: Math.max(0, ...stepCounts),
    meanModelCallsPerStep: perStep((step) => step.modelCalls),
    meanPageBytesPerStep: perStep((step) => step.pageBytes),
    meanHistoryBytesPerStep: perStep((step) => step.historyBytes),
    meanWallTimeMs: Math.round(mean(runs.map((run) => run.wallTimeMs))),
    reasons,
    chunkConflicts: sum(runs.map((run) => run.chunkConflicts)),
    noneOfTheseAnswers: sum(runs.map((run) => run.noneOfTheseAnswers)),
    repeatedSteps: sum(runs.map((run) => run.repeatedSteps ?? 0)),
    wrongTargetSteps: targeted.length === 0 ? null : sum(targeted),
    meanInputTokensPerStep: meanOrNull(reported("inputTokens")),
    meanOutputTokensPerStep: meanOrNull(reported("outputTokens")),
    meanTokensPerRun: meanOrNull(
      runs.flatMap((run) =>
        run.inputTokens === null || run.inputTokens === undefined
          ? []
          : [run.inputTokens + (run.outputTokens ?? 0)]
      )
    ),
  };
}
