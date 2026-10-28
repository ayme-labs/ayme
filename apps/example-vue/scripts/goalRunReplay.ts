/**
 * Re-scores recorded runs offline under the Step Decision's stop policy
 * (ADR-0047) at another done bar, or, for a file recorded before it, at its
 * own. The policy only relabels the step at which stage one chose no operation,
 * and never changes a step that acts, so a recorded run's stopping step is
 * all it needs: its `goal_met` and `goal_remaining`, how many steps ran
 * before it, and whether the last of them failed.
 */
import type { GoalRun } from "./goalRunReport";

/** The Step Decision's bars, `DONE_BAR` and `LOWER_BAR` in
 *  `packages/ayme/src/goal-loop/application/stepDecision.ts`, which owns them;
 *  `goalRunReplay.test.ts` fails when the two differ. */
export const doneBar = 0.7;
export const lowerBar = 0.3;
/** The done bars the sweep compares. */
export const sweptDoneBars = [0.6, 0.65, 0.7, 0.75, 0.8];

/** A run's last step, when stage one chose no operation there and the loop
 *  stopped on that choice. */
export type StoppingStep = {
  goalMet: number;
  goalRemaining?: number;
  /** The steps that ran before it: every earlier step ran its operation. */
  historyLength: number;
  /** The result of the step before it, `"ok"` or its error; undefined when
   *  the history is empty or the record does not hold it. */
  lastResult?: string;
};

export function stoppingStepOf(run: GoalRun): StoppingStep | undefined {
  const last = run.steps.at(-1);
  if (last?.operation !== "none" || last.goalMetScore === null) return;
  // A stage-one "none" ends the run with one of these; any other reason came
  // from a later check, such as an answer that failed to read.
  if (!["done", "unverified", "no_fitting_option"].includes(run.reason ?? ""))
    return;
  return {
    goalMet: last.goalMetScore,
    goalRemaining: last.goalRemainingScore,
    historyLength: run.steps.length - 1,
    lastResult: run.steps.at(-2)?.result,
  };
}

/** The history is empty, or the record holds the last step's result: the
 *  stopping step's reason depends on nothing the record lacks. */
export function replayIsExact(stop: StoppingStep) {
  return stop.historyLength === 0 || stop.lastResult !== undefined;
}

/** The reason the Step Decision gave the stopping step before the policy,
 *  to check that a file recorded then holds what decided it. */
export function reasonBeforePolicy(stop: StoppingStep) {
  const lastStepFailed = stop.historyLength > 0 && stop.lastResult !== "ok";
  const nothingOutstanding =
    !lastStepFailed &&
    stop.goalRemaining !== undefined &&
    stop.goalRemaining < 0.5;
  return stop.goalMet >= 0.5 || nothingOutstanding
    ? "done"
    : "no_fitting_option";
}

/** The reason the policy gives the stopping step at `bar`. A missing last
 *  result counts as a failed step. */
export function reasonUnderDoneBar(stop: StoppingStep, bar: number) {
  const nothingRemaining =
    stop.historyLength > 0 &&
    stop.lastResult === "ok" &&
    stop.goalRemaining !== undefined &&
    stop.goalRemaining <= lowerBar;
  if (stop.goalMet >= bar || nothingRemaining) return "done";
  return stop.goalMet >= lowerBar ? "unverified" : "no_fitting_option";
}

/** The Step Decision, before the policy or under it, gives the stopping step
 *  its recorded reason: the record holds what decided it. */
export function recordedReasonReproduced(run: GoalRun, stop: StoppingStep) {
  return (
    reasonBeforePolicy(stop) === run.reason ||
    reasonUnderDoneBar(stop, doneBar) === run.reason
  );
}

/** A run's reason under the policy: relabelled when it stopped on "none",
 *  as recorded otherwise. */
export function replayedReason(run: GoalRun, bar: number) {
  const stop = stoppingStepOf(run);
  return stop ? reasonUnderDoneBar(stop, bar) : run.reason;
}

/**
 * What a done bar costs and catches among runs that ended `done`: `lost`,
 * the ones that passed and would no longer end `done`, by their new reason;
 * `caught`, the ones that did not pass and would no longer end `done`.
 */
export function sweepDoneBar(runs: GoalRun[], bar: number) {
  const done = runs.filter((run) => run.reason === "done");
  const changed = (run: GoalRun) => replayedReason(run, bar) !== "done";
  const lost: Record<string, number> = {};
  for (const run of done.filter((run) => run.passed && changed(run))) {
    const reason = replayedReason(run, bar)!;
    lost[reason] = (lost[reason] ?? 0) + 1;
  }
  return {
    doneBar: bar,
    passedDone: done.filter((run) => run.passed).length,
    falseDone: done.filter((run) => !run.passed).length,
    lost,
    caught: done.filter((run) => !run.passed && changed(run)).length,
  };
}
