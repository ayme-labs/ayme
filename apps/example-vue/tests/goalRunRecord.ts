import type { Page, Request, TestInfo } from "@playwright/test";

import { goalRunsVariable } from "../scripts/appEnvironment";
import { decisionEndpointPath } from "../vite/decisionEndpointPath";

/** One step of a Goal Loop run, as the run harness records it. */
export type GoalRunStep = {
  /** The operation option stage one chose; `none` when nothing fits. */
  operation: string | null;
  goalMetScore: number | null;
  /** Decision Endpoint calls the step made: stage one, stage two, run-offs. */
  modelCalls: number;
  /**
   * Per argument question id, the chosen option key; only steps with stage
   * two. The loop's record where it has one, else every answer the Decision
   * Endpoint returned for an option the question offered, so chunk answers
   * survive a run-off that failed.
   */
  argumentChoices?: Record<string, string>;
  /** The step requested a run-off: several chunks of a ref question each named
   *  an element. Counted even when the run-off then failed. */
  runOff: boolean;
  /** UTF-8 bytes of the `page` and `history` state fields stage one sent, as
   *  JSON; stage two sends the same state. */
  pageBytes: number;
  historyBytes: number;
};

/** What one `pursue_goal` call did, attached to the test that made it. */
export type GoalRunRecord = {
  goal: string;
  /** The step count of a run that ends `done` as the test intends, when the
   *  test states one. */
  expectedSteps?: number;
  /** The Handover reason; null when `pursue` threw. */
  reason: string | null;
  /** The model identifiers the run's decisions asked for. */
  models: string[];
  wallTimeMs: number;
  steps: GoalRunStep[];
  /** Set when recording failed; the other fields are then what was known. */
  recorderError?: string;
};

/** One Decision Endpoint call seen from the page; `answers` only when the
 *  endpoint answered with success. */
export type Decision = {
  model: unknown;
  state?: { page?: unknown; history?: unknown };
  questions: Record<string, { criteria?: Record<string, unknown> }>;
  answers?: Record<string, { choice?: unknown }>;
};

/** A run-off question's id ends with this, as `runOffQuestionId` in
 *  `packages/webmcp/src/goalLoopQuestions.ts` builds it. */
const runOffSuffix = "run_off";

/**
 * Mirrors `GoalLoopStepScore` and the run result store in
 * `packages/webmcp/src/goalLoop.ts`, reduced to the fields read here. The store
 * is package-internal (`getLastGoalLoopRunResult` is not exported); the page
 * shares it through `globalThis`, so the browser side can read it.
 */
type GoalLoopStepScore = {
  goalMetScore: number;
  argumentChoices?: Record<string, string>;
};
export type GoalLoopRunResult = {
  handover: { reason: string };
  stepScores: GoalLoopStepScore[];
};
type RunResultStore = { last?: GoalLoopRunResult };

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/** Record the Decision Endpoint calls the page makes from now on, in order.
 *  No recorded call ever rejects on its own, so none goes unhandled. */
function recordDecisions(page: Page) {
  const pending: Promise<Decision | Error>[] = [];
  const onRequest = (request: Request) => {
    try {
      if (new URL(request.url()).pathname !== decisionEndpointPath) return;
      const body = request.postDataJSON() as Omit<Decision, "answers">;
      pending.push(
        request
          .response()
          .then(async (response) => ({
            ...body,
            answers: response?.ok()
              ? ((await response.json()) as Pick<Decision, "answers">).answers
              : undefined,
          }))
          .catch(asError)
      );
    } catch (error) {
      pending.push(Promise.resolve(asError(error)));
    }
  };
  page.on("request", onRequest);
  return {
    stop: () => page.off("request", onRequest),
    async decisions() {
      const settled = await Promise.all(pending);
      const failure = settled.find((entry) => entry instanceof Error);
      if (failure) throw failure;
      return settled as Decision[];
    },
  };
}

/** The answers of an argument call that pick an option its question offered. */
function offeredChoices(decision: Decision): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const [id, question] of Object.entries(decision.questions)) {
    const choice = decision.answers?.[id]?.choice;
    if (
      typeof choice === "string" &&
      question.criteria &&
      choice in question.criteria
    )
      choices[id] = choice;
  }
  return choices;
}

const byteLength = (value: unknown) =>
  value === undefined
    ? 0
    : new TextEncoder().encode(JSON.stringify(value)).length;

/** Group the calls into steps: every stage-one call asks `operation`. */
function stepsOf(
  decisions: Decision[],
  stepScores: GoalLoopStepScore[]
): GoalRunStep[] {
  const steps: GoalRunStep[] = [];
  for (const decision of decisions) {
    if ("operation" in decision.questions) {
      const choice = decision.answers?.operation?.choice;
      steps.push({
        operation: typeof choice === "string" ? choice : null,
        goalMetScore: null,
        modelCalls: 1,
        runOff: false,
        pageBytes: byteLength(decision.state?.page),
        historyBytes: byteLength(decision.state?.history),
      });
      continue;
    }
    const step = steps.at(-1);
    if (!step) continue;
    step.modelCalls++;
    if (Object.keys(decision.questions).some((id) => id.endsWith(runOffSuffix)))
      step.runOff = true;
    const choices = offeredChoices(decision);
    if (Object.keys(choices).length > 0)
      step.argumentChoices = { ...step.argumentChoices, ...choices };
  }
  // A step score exists for every step whose stage one the loop could read;
  // where it records a choice, the loop's record wins.
  stepScores.forEach((score, index) => {
    const step = steps[index];
    if (!step) return;
    step.goalMetScore = score.goalMetScore;
    if (score.argumentChoices)
      step.argumentChoices = {
        ...step.argumentChoices,
        ...score.argumentChoices,
      };
  });
  return steps;
}

/** What a run did, from the calls seen from the page and the loop's run result. */
export function goalRunRecordOf(
  base: Pick<GoalRunRecord, "goal" | "expectedSteps" | "reason" | "wallTimeMs">,
  decisions: Decision[],
  runResult: GoalLoopRunResult | undefined
): GoalRunRecord {
  return {
    ...base,
    reason: runResult?.handover.reason ?? base.reason,
    models: [...new Set(decisions.map((decision) => String(decision.model)))],
    steps: stepsOf(decisions, runResult?.stepScores ?? []),
  };
}

async function readRunResult(page: Page) {
  return page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __aymeGoalLoopRunResultStore?: RunResultStore;
        }
      ).__aymeGoalLoopRunResultStore?.last
  );
}

/**
 * Run `pursue` and, only when the run harness set `AYME_GOAL_RUNS=1`, attach
 * what the run did to the test for the harness to read from the Playwright
 * report. Otherwise this is a pass-through. Recording never fails the test:
 * a recorder failure becomes a record with `recorderError`, or a warning when
 * even that cannot be attached. A failure of `pursue` itself is recorded,
 * then propagates.
 */
export async function recordGoalRun<T extends { reason: string }>(
  page: Page,
  testInfo: TestInfo,
  { goal, expectedSteps }: Pick<GoalRunRecord, "goal" | "expectedSteps">,
  pursue: () => Promise<T>
): Promise<T> {
  if (process.env[goalRunsVariable] !== "1") return pursue();

  let recorder: ReturnType<typeof recordDecisions> | undefined;
  let recorderError: unknown;
  try {
    recorder = recordDecisions(page);
  } catch (error) {
    recorderError = error;
  }
  const startedAt = performance.now();
  let outcome: { handover: T } | { error: unknown };
  try {
    outcome = { handover: await pursue() };
  } catch (error) {
    outcome = { error };
  }
  try {
    recorder?.stop();
  } catch (error) {
    recorderError ??= error;
  }
  const wallTimeMs = Math.round(performance.now() - startedAt);

  // A run whose `pursue` threw is recorded too, with no reason, so it still
  // counts against the goal's expected step.
  const reason = "handover" in outcome ? outcome.handover.reason : null;
  let record: GoalRunRecord = {
    goal,
    ...(expectedSteps === undefined ? {} : { expectedSteps }),
    reason,
    models: [],
    wallTimeMs,
    steps: [],
  };
  try {
    if (recorderError) throw recorderError;
    const decisions = await recorder!.decisions();
    const runResult = await readRunResult(page);
    record = goalRunRecordOf(record, decisions, runResult);
    if (reason === null) record.reason = null;
  } catch (error) {
    record.recorderError = asError(error).message;
  }
  try {
    // `scripts/goal-runs.ts` reads the record by this name.
    await testInfo.attach("goal-run", {
      body: JSON.stringify(record),
      contentType: "application/json",
    });
  } catch (error) {
    console.warn(
      `Goal run record not attached: ${asError(error).message}`,
      record
    );
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.handover;
}
