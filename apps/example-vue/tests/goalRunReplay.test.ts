// @vitest-environment node
import { DONE_BAR, LOWER_BAR } from "@ayme-dev/ayme/testing";
import { expect, it } from "vitest";

import type { GoalRun } from "../scripts/goalRunReport";
import {
  doneBar,
  lowerBar,
  reasonBeforePolicy,
  recordedReasonReproduced,
  replayIsExact,
  replayedReason,
  stoppingStepOf,
  sweepDoneBar,
} from "../scripts/goalRunReplay";
import type { GoalRunStep } from "./goalRunRecord";

const step = (fields: Partial<GoalRunStep>): GoalRunStep => ({
  operation: "click",
  goalMetScore: 0.1,
  modelCalls: 1,
  runOff: false,
  pageBytes: 0,
  historyBytes: 0,
  ...fields,
});
const ran = (result = "ok") =>
  step({ chosen: { target: { key: "e1", description: "button" } }, result });
const none = (goalMetScore: number, goalRemainingScore: number) =>
  step({ operation: "none", goalMetScore, goalRemainingScore });
const runOf = (
  reason: string | null,
  steps: GoalRunStep[],
  passed = true
): GoalRun => ({
  passed,
  reason,
  stepCount: steps.length,
  wallTimeMs: 1,
  steps,
  chunkConflicts: 0,
  noneOfTheseAnswers: 0,
  repeatedSteps: 0,
  inputTokens: null,
  outputTokens: null,
});

it("relabels a stop on no operation by goal_met against the done bar", () => {
  const at = (goalMet: number) =>
    replayedReason(runOf("done", [none(goalMet, 0.9)]), 0.7);
  expect([0.7, 0.69, 0.3, 0.29].map(at)).toEqual([
    "done",
    "unverified",
    "unverified",
    "no_fitting_option",
  ]);
});

it("ends done on nothing remaining only after a step that ran ok", () => {
  const stopsAfter = (history: GoalRunStep[], goalRemaining: number) =>
    replayedReason(runOf("done", [...history, none(0.4, goalRemaining)]), 0.7);
  expect(stopsAfter([ran()], 0.3)).toBe("done");
  expect(stopsAfter([ran()], 0.31)).toBe("unverified");
  expect(stopsAfter([], 0.05)).toBe("unverified");
  expect(stopsAfter([ran("Timeout")], 0.05)).toBe("unverified");
  // A record without the result counts as a failed step, and is not exact.
  const unrecorded = runOf("done", [step({ chosen: {} }), none(0.4, 0.05)]);
  expect(replayedReason(unrecorded, 0.7)).toBe("unverified");
  expect(replayIsExact(stoppingStepOf(unrecorded)!)).toBe(false);
  expect(replayIsExact(stoppingStepOf(runOf("done", [none(0.4, 0.05)]))!)).toBe(
    true
  );
});

it("keeps the reason of a run that did not stop on no operation", () => {
  expect(replayedReason(runOf("step_budget", [ran(), ran()]), 0.7)).toBe(
    "step_budget"
  );
  expect(replayedReason(runOf("decide_failed", [none(0.1, 0.9)]), 0.7)).toBe(
    "decide_failed"
  );
  expect(replayedReason(runOf(null, []), 0.7)).toBeNull();
});

it("reproduces the reason from before the policy from the stopping step", () => {
  const today = (steps: GoalRunStep[]) =>
    reasonBeforePolicy(stoppingStepOf(runOf("done", steps))!);
  expect(today([none(0.55, 0.9)])).toBe("done");
  expect(today([none(0.2, 0.45)])).toBe("done");
  expect(today([ran("Timeout"), none(0.2, 0.45)])).toBe("no_fitting_option");
  expect(today([none(0.2, 0.6)])).toBe("no_fitting_option");
});

it("counts the passed done runs a bar loses and the false done runs it catches", () => {
  const runs = [
    runOf("done", [none(0.9, 0.1)]),
    runOf("done", [none(0.65, 0.4)]),
    runOf("done", [none(0.2, 0.4)]),
    runOf("done", [none(0.55, 0.4)], false),
    runOf("done", [ran(), none(0.1, 0.2)], false),
    runOf("no_fitting_option", [none(0.1, 0.9)], false),
  ];
  expect(sweepDoneBar(runs, 0.7)).toEqual({
    doneBar: 0.7,
    passedDone: 3,
    falseDone: 2,
    lost: { unverified: 1, no_fitting_option: 1 },
    caught: 1,
  });
  expect(sweepDoneBar(runs, 0.6).lost).toEqual({ no_fitting_option: 1 });
});

it("replays a run recorded under the policy, and reproduces its reason", () => {
  const unverified = runOf("unverified", [none(0.55, 0.45)], false);
  const stop = stoppingStepOf(unverified)!;
  expect(replayedReason(unverified, 0.5)).toBe("done");
  expect(recordedReasonReproduced(unverified, stop)).toBe(true);
  expect(
    recordedReasonReproduced(
      runOf("no_fitting_option", [none(0.55, 0.45)]),
      stop
    )
  ).toBe(false);
});

it("replays with the bars the Step Decision stops on", () => {
  expect([doneBar, lowerBar]).toEqual([DONE_BAR, LOWER_BAR]);
});
