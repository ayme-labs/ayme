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
  /** Per argument question id, the chosen option key; only steps with stage two. */
  argumentChoices?: Record<string, string>;
};

/** What one `pursue_goal` call did, attached to the test that made it. */
export type GoalRunRecord = {
  goal: string;
  reason: string;
  /** The model identifiers the run's decisions asked for. */
  models: string[];
  wallTimeMs: number;
  steps: GoalRunStep[];
  /** Set when recording failed; the other fields are then what was known. */
  recorderError?: string;
};

type Decision = {
  model: unknown;
  questions: Record<string, unknown>;
  answers?: Record<string, { choice?: unknown }>;
};

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
type RunResultStore = {
  last?: { handover: { reason: string }; stepScores: GoalLoopStepScore[] };
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
        modelCalls: 0,
      });
    }
    const step = steps.at(-1);
    if (step) step.modelCalls++;
  }
  // A step score exists for every step whose stage one the loop could read.
  stepScores.forEach((score, index) => {
    const step = steps[index];
    if (!step) return;
    step.goalMetScore = score.goalMetScore;
    if (score.argumentChoices) step.argumentChoices = score.argumentChoices;
  });
  return steps;
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
 * even that cannot be attached. A failure of `pursue` itself propagates.
 */
export async function recordGoalRun<T extends { reason: string }>(
  page: Page,
  testInfo: TestInfo,
  goal: string,
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
  let handover: T;
  try {
    handover = await pursue();
  } finally {
    try {
      recorder?.stop();
    } catch (error) {
      recorderError ??= error;
    }
  }
  const wallTimeMs = Math.round(performance.now() - startedAt);

  let record: GoalRunRecord = {
    goal,
    reason: handover.reason,
    models: [],
    wallTimeMs,
    steps: [],
  };
  try {
    if (recorderError) throw recorderError;
    const decisions = await recorder!.decisions();
    const runResult = await readRunResult(page);
    record = {
      ...record,
      reason: runResult?.handover.reason ?? handover.reason,
      models: [...new Set(decisions.map((decision) => String(decision.model)))],
      steps: stepsOf(decisions, runResult?.stepScores ?? []),
    };
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
  return handover;
}
