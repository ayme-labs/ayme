// @vitest-environment node
import type { Page, TestInfo } from "@playwright/test";
import { expect, it, vi } from "vitest";

import { goalRunsVariable } from "../scripts/appEnvironment";
import { aggregate, toGoalRun } from "../scripts/goalRunReport";
import { goalRunRecordOf, recordGoalRun, type Decision } from "./goalRunRecord";

it("passes the run straight through unless the run harness asks for a record", async () => {
  vi.stubEnv(goalRunsVariable, undefined);
  const page = { on: vi.fn(), evaluate: vi.fn() };
  const testInfo = { attach: vi.fn() };
  const handover = { reason: "done" };

  await expect(
    recordGoalRun(
      page as unknown as Page,
      testInfo as unknown as TestInfo,
      "a goal",
      async () => handover
    )
  ).resolves.toBe(handover);
  for (const spy of [page.on, page.evaluate, testInfo.attach])
    expect(spy).not.toHaveBeenCalled();
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
      argumentChoices: { ref__1: "e1", ref__2: "e9" },
    },
  ]);
  expect(aggregate([run])).toMatchObject({
    chunkConflicts: 1,
    noneOfTheseAnswers: 0,
    meanModelCallsPerStep: 3,
  });
});
