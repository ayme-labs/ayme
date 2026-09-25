import type { Page, Request, TestInfo } from "@playwright/test";

import { decisionEndpointPath } from "../vite/decisionEndpointPath";

/** One step of a Goal Loop run, as the run harness records it. */
export type GoalRunStep = {
  /** The operation option stage one chose; `none` when nothing fits. */
  operation: string | null;
  goalMetScore: number | null;
  /** Decision Endpoint calls the step made: stage one, stage two, run-offs. */
  modelCalls: number;
  /** Per argument question id, the chosen option key, when the loop records it. */
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
};

type Decision = {
  model: unknown;
  questions: Record<string, unknown>;
  answers?: Record<string, { choice?: unknown }>;
};

/** Package-internal store `getLastGoalLoopRunResult` reads; the page shares it
 *  through `globalThis`, so the browser side can read it without an export. */
type RunResultStore = {
  last?: {
    handover: { reason: string };
    stepScores: {
      goalMetScore: number;
      argumentChoices?: Record<string, string>;
    }[];
  };
};

/** Record the Decision Endpoint calls the page makes from now on, in order. */
function recordDecisions(page: Page) {
  const pending: Promise<Decision>[] = [];
  const onRequest = (request: Request) => {
    if (new URL(request.url()).pathname !== decisionEndpointPath) return;
    const body = request.postDataJSON() as Omit<Decision, "answers">;
    pending.push(
      request.response().then(async (response) => ({
        ...body,
        answers: response?.ok()
          ? ((await response.json()) as Pick<Decision, "answers">).answers
          : undefined,
      }))
    );
  };
  page.on("request", onRequest);
  return async () => {
    page.off("request", onRequest);
    return Promise.all(pending);
  };
}

/** Group the calls into steps: every stage-one call asks `operation`. */
function stepsOf(
  decisions: Decision[],
  stepScores: NonNullable<RunResultStore["last"]>["stepScores"]
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

/**
 * Run `pursue` and attach what the run did to the test, so the run harness can
 * read it from the Playwright report. The attachment is made before the test
 * asserts anything, so a failed run is recorded too.
 */
export async function recordGoalRun<T extends { reason: string }>(
  page: Page,
  testInfo: TestInfo,
  goal: string,
  pursue: () => Promise<T>
): Promise<T> {
  const stopRecording = recordDecisions(page);
  const startedAt = performance.now();
  const handover = await pursue();
  const wallTimeMs = Math.round(performance.now() - startedAt);
  const decisions = await stopRecording();
  const runResult = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __aymeGoalLoopRunResultStore?: RunResultStore;
        }
      ).__aymeGoalLoopRunResultStore?.last
  );

  const record: GoalRunRecord = {
    goal,
    reason: runResult?.handover.reason ?? handover.reason,
    models: [...new Set(decisions.map((decision) => String(decision.model)))],
    wallTimeMs,
    steps: stepsOf(decisions, runResult?.stepScores ?? []),
  };
  // `scripts/goal-runs.ts` reads the record by this name.
  await testInfo.attach("goal-run", {
    body: JSON.stringify(record),
    contentType: "application/json",
  });
  return handover;
}
