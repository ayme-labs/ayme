import type { Page, Request, TestInfo } from "@playwright/test";

import {
  readLastGoalLoopRunResult,
  type GoalLoopStepScore,
} from "@ayme-dev/ayme/testing";

import { goalRunsVariable } from "../scripts/appEnvironment";
import { decisionEndpointPath } from "../vite/decisionEndpointPath";

/** One step of a Goal Loop run, as the run harness records it. */
export type GoalRunStep = {
  /** The operation option stage one chose; `none` when nothing fits. */
  operation: string | null;
  goalMetScore: number | null;
  goalRemainingScore?: number;
  /** Decision Endpoint calls the step made: stage one, stage two, run-offs. */
  modelCalls: number;
  /**
   * Per argument question id, the chosen option key, as the loop's step
   * record holds it; only steps with stage two. Chunk answers stay when a
   * run-off then failed.
   */
  argumentChoices?: Record<string, string>;
  /**
   * Per argument question id in `argumentChoices`, the chosen option's
   * description as the question offered it, such as `textbox "Email"` for an
   * element or `email: ada@example.com` for a Goal Value.
   */
  argumentDescriptions?: Record<string, string>;
  /**
   * The arguments the step ran its operation with, per parameter: the key and
   * description of the option chosen, as the loop's step record holds them.
   * Absent for a step that ran no operation, or when the loop's run result
   * could not be read.
   */
  chosen?: Record<string, { key: string; description: string }>;
  /** `"ok"`, or the error the operation failed with, as the loop's step
   *  record holds it; absent for a step that ran no operation, or when the
   *  loop's run result could not be read. */
  result?: string;
  /** The step asked a run-off, as the loop's step record says: several
   *  chunks of a ref question each named an element. Counted even when the
   *  run-off then failed. */
  runOff: boolean;
  /** UTF-8 bytes of the `page` and `history` state fields stage one sent, as
   *  JSON; stage two sends the same state. */
  pageBytes: number;
  historyBytes: number;
  /** The tokens the step's calls used, summed over the calls whose response
   *  reported `usage`; absent when none did. */
  inputTokens?: number;
  outputTokens?: number;
};

/** What one `goal` call did, attached to the test that made it. */
export type GoalRunRecord = {
  goal: string;
  /** The step count of a run that ends `done` as the test intends, when the
   *  test states one. */
  expectedSteps?: number;
  /**
   * Per Goal Value label, the description of the element a `fill` or `type`
   * of that value should target, such as `textbox "Display name"`, when the
   * test states them.
   */
  expectedTargets?: Record<string, string>;
  /** The Handover reason; null when `pursue` threw. */
  reason: string | null;
  /** The model identifiers that answered the run's decisions. */
  models: string[];
  wallTimeMs: number;
  steps: GoalRunStep[];
  /** Set when recording failed; the other fields are then what was known. */
  recorderError?: string;
};

/** One Decision Endpoint call seen from the page; `model` and `answers` only
 *  when the endpoint answered with success. */
export type Decision = {
  model?: unknown;
  state?: { page?: unknown; history?: unknown };
  questions: Record<string, { criteria?: Record<string, unknown> }>;
  answers?: Record<string, { choice?: unknown }>;
  /** The provider's token usage, which the Decision Endpoint passes through
   *  with the answers when the provider reports it. */
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/** Record the Decision Endpoint calls the page makes from now on, in order.
 *  No recorded call ever rejects on its own, so none goes unhandled. */
function recordDecisions(page: Page) {
  const pending: Promise<Decision | Error>[] = [];
  const onRequest = (request: Request) => {
    try {
      if (new URL(request.url()).pathname !== decisionEndpointPath) return;
      const body = request.postDataJSON() as Omit<
        Decision,
        "model" | "answers"
      >;
      pending.push(
        request
          .response()
          .then(async (response) => {
            if (!response?.ok()) return body;
            const { model, answers, usage } = (await response.json()) as Pick<
              Decision,
              "model" | "answers" | "usage"
            >;
            return { ...body, model, answers, usage };
          })
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

/** The description of the option each answer of `choices` picked, from the
 *  criteria of the question that offered it. */
function choiceDescriptions(
  decision: Decision,
  choices: Record<string, string>
): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const [id, choice] of Object.entries(choices)) {
    const description = decision.questions[id]?.criteria?.[choice];
    if (typeof description === "string") descriptions[id] = description;
  }
  return descriptions;
}

/** Add the call's reported token usage, if any, to the step's. */
function addUsage(step: GoalRunStep, decision: Decision) {
  const input = decision.usage?.input_tokens;
  const output = decision.usage?.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return;
  step.inputTokens = (step.inputTokens ?? 0) + input;
  step.outputTokens = (step.outputTokens ?? 0) + output;
}

const byteLength = (value: unknown) =>
  value === undefined
    ? 0
    : new TextEncoder().encode(JSON.stringify(value)).length;

/** Group the calls into steps: every stage-one call asks `operation`. */
function stepsOf(
  decisions: Decision[],
  stepScores: readonly GoalLoopStepScore[]
): GoalRunStep[] {
  const steps: GoalRunStep[] = [];
  // Per step, its argument calls in order, to describe the choices with.
  const argumentCalls: Decision[][] = [];
  for (const decision of decisions) {
    if ("operation" in decision.questions) {
      const choice = decision.answers?.operation?.choice;
      const step: GoalRunStep = {
        operation: typeof choice === "string" ? choice : null,
        goalMetScore: null,
        modelCalls: 1,
        runOff: false,
        pageBytes: byteLength(decision.state?.page),
        historyBytes: byteLength(decision.state?.history),
      };
      addUsage(step, decision);
      steps.push(step);
      argumentCalls.push([]);
      continue;
    }
    const step = steps.at(-1);
    if (!step) continue;
    step.modelCalls++;
    addUsage(step, decision);
    argumentCalls.at(-1)!.push(decision);
  }
  // A step score exists for every step whose stage one the loop could read.
  stepScores.forEach((score, index) => {
    const step = steps[index];
    if (!step) return;
    step.goalMetScore = score.goalMetScore;
    if (score.goalRemainingScore !== undefined)
      step.goalRemainingScore = score.goalRemainingScore;
    if (score.runOff) step.runOff = true;
    if ("chosen" in score) step.chosen = score.chosen;
    if ("result" in score) step.result = score.result;
    if (score.argumentChoices && Object.keys(score.argumentChoices).length > 0)
      step.argumentChoices = { ...score.argumentChoices };
  });
  steps.forEach((step, index) => {
    if (!step.argumentChoices) return;
    const descriptions = Object.assign(
      {},
      ...argumentCalls[index]!.map((decision) =>
        choiceDescriptions(decision, step.argumentChoices!)
      )
    ) as Record<string, string>;
    if (Object.keys(descriptions).length > 0)
      step.argumentDescriptions = descriptions;
  });
  return steps;
}

/** What a run did, from the calls seen from the page and the loop's step
 *  scores, empty when its run result could not be read. */
export function goalRunRecordOf(
  base: Pick<
    GoalRunRecord,
    "goal" | "expectedSteps" | "expectedTargets" | "reason" | "wallTimeMs"
  >,
  decisions: Decision[],
  stepScores: readonly GoalLoopStepScore[]
): GoalRunRecord {
  return {
    ...base,
    models: [
      ...new Set(
        decisions.flatMap((decision) =>
          decision.model === undefined ? [] : [String(decision.model)]
        )
      ),
    ],
    steps: stepsOf(decisions, stepScores),
  };
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
  {
    goal,
    expectedSteps,
    expectedTargets,
  }: Pick<GoalRunRecord, "goal" | "expectedSteps" | "expectedTargets">,
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
    ...(expectedTargets === undefined ? {} : { expectedTargets }),
    reason,
    models: [],
    wallTimeMs,
    steps: [],
  };
  try {
    if (recorderError) throw recorderError;
    const decisions = await recorder!.decisions();
    const runResult = await readLastGoalLoopRunResult(page);
    record = goalRunRecordOf(record, decisions, runResult?.stepScores ?? []);
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
