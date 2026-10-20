import { expect, test, type Page } from "@playwright/test";
import {
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/webmcp/testing";

import { goalRunsVariable } from "../scripts/appEnvironment";
import {
  aggregate,
  toGoalRun,
  type ReportResult,
} from "../scripts/goalRunReport";
import { decisionEndpointPath } from "../vite/decisionEndpointPath";
import {
  benchGoals,
  expectedStepsOf,
  expectedTargetsOf,
  openBenchPage,
  type IntendedStep,
} from "./benchGoals";
import { pursueGoal } from "./goalLane";

/**
 * The bench goal set's plumbing, without a model (`test:e2e:dev`, through
 * `playwright.benchScripted.config.ts`). The dev server runs with a stand-in
 * model key, so the pages publish `goal`; every decision request the page
 * makes is answered here, in the browser context, and never reaches the
 * server. Each goal is pursued with its intended steps as the answers, through
 * the run recorder, and must reach its outcome at its expected step count.
 */

// Record every run, as `pnpm run goals:runs` does, to check the report.
process.env[goalRunsVariable] = "1";

/** What every scripted answer reports as its token usage. */
const usage = { input_tokens: 100, output_tokens: 4 };

type Question = {
  type: "choice" | "noul";
  instructions: string;
  criteria?: Record<string, string>;
};

/** The ref option keys whose description is `target`, in document order. */
function refsDescribed(criteria: Record<string, string>, target: string) {
  return Object.entries(criteria)
    .filter(([, description]) => description === target)
    .map(([key]) => key);
}

/** Stage two's answers for one intended step. */
function argumentAnswers(
  step: IntendedStep,
  questions: Record<string, Question>
) {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => {
      if (question.type === "noul") {
        // A list parameter asks per Goal Value whether it belongs.
        const label = /Goal Value "([^"]+?): /.exec(question.instructions)?.[1];
        const included =
          id.startsWith("values") && step.values?.includes(label ?? "");
        return [id, { type: "noul", noul: included ? 0.95 : 0.05 }];
      }
      const criteria = question.criteria ?? {};
      let choice: string | undefined;
      if (id === "target") {
        const refs = refsDescribed(criteria, step.target ?? "");
        choice = refs[step.nth ?? 0];
        if (choice === undefined)
          throw new Error(
            `No target ${step.target} among ${JSON.stringify(Object.values(criteria))}`
          );
      } else if (id === "text") choice = step.text;
      // An optional parameter the step does not set.
      else choice = "leave_unset";
      if (choice === undefined || !(choice in criteria))
        throw new Error(`No option ${choice} for ${id}`);
      return [id, { type: "choice", choice }];
    })
  );
}

/**
 * Answer the page's decision requests with `intended`: stage one picks the
 * next step's operation with the goal not met, and once the steps run out
 * judges the goal met; stage two picks the step's arguments. A request the
 * script cannot answer fails the test.
 */
async function answerDecisions(page: Page, intended: IntendedStep[]) {
  let next = 0;
  const failures: string[] = [];
  await page.route(`**${decisionEndpointPath}`, async (route) => {
    const { questions } = route.request().postDataJSON() as {
      questions: Record<string, Question>;
    };
    try {
      let answers: Record<string, unknown>;
      if ("operation" in questions) {
        const step = intended[next++];
        // Stage one also asks speculative Goal Value questions; the script
        // leaves every value to stage two.
        answers = Object.fromEntries(
          Object.keys(questions).map((id) => [
            id,
            { type: "choice", choice: "no_value_needed" },
          ])
        );
        Object.assign(answers, {
          operation: { type: "choice", choice: step?.operation ?? "none" },
          goal_met: { type: "noul", noul: step ? 0.05 : 0.95 },
          goal_remaining: { type: "noul", noul: step ? 0.95 : 0.05 },
        });
      } else {
        answers = argumentAnswers(intended[next - 1]!, questions);
      }
      await route.fulfill({ json: { model: "scripted", answers, usage } });
    } catch (error) {
      failures.push((error as Error).message);
      await route.fulfill({ status: 500, json: { error: "unscripted" } });
    }
  });
  return failures;
}

/** The run the harness would report from this test's `goal-run` attachment. */
function reportedRun() {
  const attachment = test
    .info()
    .attachments.find((candidate) => candidate.name === "goal-run");
  expect(attachment?.body).toBeDefined();
  const result: ReportResult = {
    status: "passed",
    duration: 0,
    attachments: [
      { name: "goal-run", body: attachment!.body!.toString("base64") },
    ],
  };
  return toGoalRun(result).run;
}

test.beforeEach(({ context }) => recordPublishedTools(context));

for (const bench of benchGoals) {
  test(`scripted: ${bench.title}`, async ({ page }) => {
    const failures = await answerDecisions(page, bench.intended);
    await openBenchPage(page, bench);
    await waitForPublishedTool(page, "goal");

    const expectedSteps = expectedStepsOf(bench);
    const handover = await pursueGoal(page, bench.goal, bench.maxSteps, {
      values: bench.values,
      expectedSteps,
      expectedTargets: expectedTargetsOf(bench),
    });

    expect(failures).toEqual([]);
    expect(handover.reason).toBe(bench.reason);
    await bench.outcome(page);

    const run = reportedRun();
    const steps = expectedSteps ?? bench.intended.length;
    expect(run.stepCount).toBe(steps);
    if (expectedSteps !== undefined) expect(run.doneAtExpectedStep).toBe(true);
    expect(run.repeatedSteps).toBe(0);
    if (expectedTargetsOf(bench)) expect(run.wrongTargetSteps).toBe(0);
    expect(run.inputTokens).toBe(
      usage.input_tokens * run.steps.reduce((n, s) => n + s.modelCalls, 0)
    );
  });
}

test("scripted: the harness counts repeated and wrong-target steps", async ({
  page,
}) => {
  const bench = benchGoals.find(
    (candidate) => candidate.title === "profile: change the display name"
  )!;
  // The failure seen without Page Objects: the right operation and value,
  // the first textbox in document order, the same step again and again.
  const wrongFill: IntendedStep = {
    operation: "fill",
    target: 'textbox "First name"',
    text: "display name",
  };
  await answerDecisions(page, [wrongFill, wrongFill, wrongFill]);
  await openBenchPage(page, bench);
  await waitForPublishedTool(page, "goal");

  const handover = await pursueGoal(page, bench.goal, 3, {
    values: bench.values,
    expectedSteps: expectedStepsOf(bench),
    expectedTargets: expectedTargetsOf(bench),
  });

  // The loop runs the wrong fill twice and stops the third time it chooses
  // it, before running it: the step was decided, so it counts and costs
  // tokens, but it neither repeats nor misses a target.
  expect(handover.reason).toBe("no_progress");
  await expect(page.getByLabel("First name")).toHaveValue("amazing-grace");
  const run = reportedRun();
  expect(run).toMatchObject({
    stepCount: 3,
    doneAtExpectedStep: false,
    repeatedSteps: 1,
    wrongTargetSteps: 2,
    inputTokens: 600,
    outputTokens: 24,
  });
  expect(run.steps[0]!.argumentDescriptions).toEqual({
    target: 'textbox "First name"',
    text: "display name: amazing-grace",
  });
  expect(aggregate([run])).toMatchObject({
    repeatedSteps: 1,
    wrongTargetSteps: 2,
    meanInputTokensPerStep: 200,
    meanOutputTokensPerStep: 8,
    meanTokensPerRun: 624,
  });
});
