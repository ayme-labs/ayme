// @vitest-environment node
import type { Page, TestInfo } from "@playwright/test";
import { expect, it, vi } from "vitest";

import { goalRunsVariable } from "../scripts/appEnvironment";
import { aggregate, toGoalRun } from "../scripts/goalRunReport";
import {
  goalRunRecordOf,
  recordGoalRun,
  type Decision,
  type GoalRunRecord,
} from "./goalRunRecord";

it("passes the run straight through unless the run harness asks for a record", async () => {
  vi.stubEnv(goalRunsVariable, undefined);
  const page = { on: vi.fn(), evaluate: vi.fn() };
  const testInfo = { attach: vi.fn() };
  const handover = { reason: "done" };

  await expect(
    recordGoalRun(
      page as unknown as Page,
      testInfo as unknown as TestInfo,
      { goal: "a goal" },
      async () => handover
    )
  ).resolves.toBe(handover);
  for (const spy of [page.on, page.evaluate, testInfo.attach])
    expect(spy).not.toHaveBeenCalled();
});

it("records a run whose pursue throws, so it counts as not done at the expected step", async () => {
  vi.stubEnv(goalRunsVariable, "1");
  const page = { on: vi.fn(), off: vi.fn(), evaluate: vi.fn() };
  const attach = vi.fn();
  const failure = new Error("pursue_goal exploded");

  await expect(
    recordGoalRun(
      page as unknown as Page,
      { attach } as unknown as TestInfo,
      { goal: "archive it", expectedSteps: 2 },
      async () => {
        throw failure;
      }
    )
  ).rejects.toBe(failure);

  expect(attach).toHaveBeenCalledOnce();
  const [name, { body }] = attach.mock.calls[0]! as [string, { body: string }];
  const record = JSON.parse(body) as GoalRunRecord;
  expect(record).toMatchObject({
    goal: "archive it",
    expectedSteps: 2,
    reason: null,
    models: [],
    steps: [],
  });
  expect(record).not.toHaveProperty("recorderError");

  expect(name).toBe("goal-run");
  const { run } = toGoalRun(testResultOf(record));
  expect(run.doneAtExpectedStep).toBe(false);
  expect(aggregate([run, run]).doneAtExpectedStepRate).toBe(0);
  vi.unstubAllEnvs();
});

it("counts a chunk conflict and keeps the chunk choices when the run-off fails", () => {
  const model = "typesafe/jev-1.13";
  const decisions: Decision[] = [
    {
      model,
      questions: {
        operation: { criteria: { "ListPage.items.archive": "", none: "" } },
        goal_met: {},
      },
      answers: {
        operation: { choice: "ListPage.items.archive" },
        goal_met: {},
      },
    },
    {
      model,
      questions: {
        ref__1: { criteria: { e1: "", none_of_these: "" } },
        ref__2: { criteria: { e9: "", none_of_these: "" } },
      },
      answers: { ref__1: { choice: "e1" }, ref__2: { choice: "e9" } },
    },
    // The run-off was requested, and its response was not a success.
    { model, questions: { ref__run_off: { criteria: { e1: "", e9: "" } } } },
  ];
  const record = goalRunRecordOf(
    { goal: "Archive the second item", reason: "decide_failed", wallTimeMs: 1 },
    decisions,
    {
      handover: { reason: "decide_failed" },
      stepScores: [{ goalMetScore: 0.1 }],
    }
  );
  const { run } = toGoalRun({
    status: "failed",
    duration: 1,
    attachments: [
      {
        name: "goal-run",
        body: Buffer.from(JSON.stringify(record)).toString("base64"),
      },
    ],
  });

  expect(run.reason).toBe("decide_failed");
  expect(run.steps).toEqual([
    {
      operation: "ListPage.items.archive",
      goalMetScore: 0.1,
      modelCalls: 3,
      runOff: true,
      // The decisions carry no state here.
      pageBytes: 0,
      historyBytes: 0,
      argumentChoices: { ref__1: "e1", ref__2: "e9" },
    },
  ]);
  expect(aggregate([run])).toMatchObject({
    chunkConflicts: 1,
    noneOfTheseAnswers: 0,
    meanModelCallsPerStep: 3,
  });
});

/** A test result carrying `record` as its `goal-run` attachment. */
function testResultOf(record: GoalRunRecord) {
  return {
    status: record.reason === "done" ? "passed" : "failed",
    duration: 1,
    attachments: [
      {
        name: "goal-run",
        body: Buffer.from(JSON.stringify(record)).toString("base64"),
      },
    ],
  };
}

/** One stage-one call that chose `operation`, sent with `state`. */
function stageOne(operation: string, state: Decision["state"]): Decision {
  return {
    model: "typesafe/jev-1.13",
    state,
    questions: { operation: { criteria: { [operation]: "" } }, goal_met: {} },
    answers: { operation: { choice: operation }, goal_met: {} },
  };
}

it("reports done at the expected step, no fitting option, and state bytes per step", () => {
  // UTF-8 bytes, not characters: `["é"]` is six.
  const page = ["é"];
  const history = [{ operation: "ListPage.items.archive", changes: "- é" }];
  const historyBytes = new TextEncoder().encode(JSON.stringify(history)).length;
  const runOf = (
    reason: string,
    operations: string[],
    expectedSteps: number | null = 2
  ) =>
    toGoalRun(
      testResultOf(
        goalRunRecordOf(
          {
            goal: "archive it",
            expectedSteps: expectedSteps ?? undefined,
            reason,
            wallTimeMs: 1,
          },
          operations.map((operation, index) =>
            stageOne(operation, { page, history: index === 0 ? [] : history })
          ),
          undefined
        )
      )
    ).run;

  const doneAtTwo = runOf("done", ["ListPage.items.archive", "none"]);
  const doneAtThree = runOf("done", [
    "ListPage.items.archive",
    "ListPage.items.archive",
    "none",
  ]);
  const noFit = runOf("no_fitting_option", ["ListPage.items.archive", "none"]);

  expect(doneAtTwo.steps.map((step) => step.pageBytes)).toEqual([6, 6]);
  expect(doneAtTwo.steps.map((step) => step.historyBytes)).toEqual([
    2,
    historyBytes,
  ]);
  expect(
    [doneAtTwo, doneAtThree, noFit].map((run) => run.doneAtExpectedStep)
  ).toEqual([true, false, false]);
  expect(aggregate([doneAtTwo, doneAtThree, noFit])).toMatchObject({
    doneAtExpectedStepRate: 1 / 3,
    noFittingOptionRate: 1 / 3,
    meanModelCallsPerStep: 1,
    meanPageBytesPerStep: 6,
    // Seven steps: three first steps with an empty history, four with one.
    meanHistoryBytesPerStep: (3 * 2 + 4 * historyBytes) / 7,
  });

  // A test that states no expected step count has no such rate.
  const unstated = runOf("done", ["none"], null);
  expect(unstated.doneAtExpectedStep).toBeUndefined();
  expect(aggregate([unstated]).doneAtExpectedStepRate).toBeNull();
});
