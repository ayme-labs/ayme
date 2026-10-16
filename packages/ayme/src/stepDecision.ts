import {
  DecisionEndpointError,
  type DecisionFailure,
  type DecisionRequest,
  type DecisionResponse,
  isRetryableDecisionFailure,
} from "./decisionWire";
import { asSentence } from "./errors";
import type {
  ChosenOption,
  GoalLoopStepRecord,
  HandoverNeeds,
  HandoverReason,
} from "./handover";
import type { PageStateCapture } from "./pageState";
import {
  buildArgumentRequest,
  buildOperationRequest,
  buildSpeculativeValueQuestions,
  buildStepState,
  completeArguments,
  fitListsToTarget,
  operationQuestionFits,
  parseGoalMetAnswer,
  parseOperationAnswer,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  readSpeculativeValues,
  type AnswerRecord,
  type ChosenArguments,
  type GoalLoopOperation,
  type GoalValues,
  type ToolOption,
} from "./goalLoopQuestions";

/**
 * The Step Decision: what one step of the Goal Loop does, decided from the
 * page the loop received, the goal, the Goal Values and the steps so far. It
 * asks the decision function in stages and ends in an operation with its
 * arguments, or in the reason the loop stops. It reads nothing from the
 * runtime: the loop gathers the inputs, runs the operation and records the
 * step.
 */

/** The port to the System One model: one decision request, one response. */
export type GoalLoopDecisionFunction = (
  request: DecisionRequest
) => Promise<DecisionResponse>;

/** What the model's answers scored in one step. */
export type StepScores = {
  operationProbabilities?: Record<string, number>;
  goalMetScore: number;
  /**
   * Stage one, per speculative question that covers the chosen operation: the
   * key of the option chosen.
   */
  valueChoices?: Record<string, string>;
  /** Stage one, per such question: the scores the decision function supplied. */
  valueProbabilities?: Record<string, Record<string, number>>;
  /**
   * Stage two, per question id: the key of the option chosen for every
   * argument question answered, chunks and run-off included.
   */
  argumentChoices?: Record<string, string>;
  /** Stage two, per question id: the scores the decision function supplied. */
  argumentProbabilities?: Record<string, Record<string, number>>;
  /**
   * The executed step's Change Record in full, as its action result carried
   * it: what the action changed, up to the Settled Page after it. The step
   * record sends it cut to `MAX_STEP_CHANGES`; absent when the step ran no
   * action or the action changed nothing.
   */
  changes?: string;
  /**
   * The step asked a run-off: several chunks of a ref question each named an
   * element. Set before the run-off is asked, so it stays when that fails.
   */
  runOff?: true;
};

/** What one step is decided from. */
export type StepInput = {
  goal: string;
  values?: GoalValues;
  /** The steps executed so far, oldest first. */
  history: readonly GoalLoopStepRecord[];
  /** The page the loop received for this step; both stages decide on it. */
  capture: PageStateCapture;
  /** The operations the page offers at this step. */
  toolOptions: readonly ToolOption[];
  /** The registered Page Object definitions, rendered for the model. */
  pomDefinitions: string;
  decide: GoalLoopDecisionFunction;
};

/** Run this operation with these arguments. */
export type StepAction = {
  kind: "act";
  operation: GoalLoopOperation;
  args: Record<string, unknown>;
  /** Per parameter asked: the option the model chose, exactly as offered. */
  chosen: Record<string, ChosenOption>;
  scores: StepScores;
};

/**
 * Stop without acting, with the Handover's reason, `next` and `needs`. The
 * scores are absent when the step ended before the model answered.
 */
export type StepStop = {
  kind: "stop";
  reason: HandoverReason;
  next: string;
  needs?: HandoverNeeds;
  scores?: StepScores;
};

export type StepVerdict = StepAction | StepStop;

// --- Stuck detection ---

/**
 * A step the loop would run a second time in a row, with the same operation
 * and chosen arguments, after a run that did not change the page, ends the run.
 */
export const NO_CHANGE_REPEAT_LIMIT = 2;
/**
 * A step the loop would run a third time in a row, with the same operation and
 * chosen arguments, ends the run even when the page changed in between: it is
 * an alternation that never converges.
 */
export const CHANGE_REPEAT_LIMIT = 3;

/**
 * A step's identity for repetition: the operation and the key chosen per
 * parameter, in parameter-name order, as stage one and stage two may record
 * the same choices in different orders.
 */
const stepSignature = (
  operation: string,
  chosen: Record<string, ChosenOption>
): string =>
  JSON.stringify([
    operation,
    Object.entries(chosen)
      .map(([parameter, option]) => [parameter, option.key])
      .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0)),
  ]);

/**
 * The step before the one about to run, when running it would repeat the
 * limits above; `undefined` otherwise. Only steps that ran to "ok" count: a
 * failing step is `action_failed`'s to end.
 */
function stuckOn(
  history: readonly GoalLoopStepRecord[],
  operation: string,
  chosen: Record<string, ChosenOption>
): { previous: GoalLoopStepRecord; times: number } | undefined {
  const signature = stepSignature(operation, chosen);
  const repeats: GoalLoopStepRecord[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]!;
    if (
      entry.result !== "ok" ||
      stepSignature(entry.operation, entry.chosen) !== signature
    )
      break;
    repeats.push(entry);
  }
  const times = repeats.length + 1;
  const previous = repeats[0];
  if (!previous) return undefined;
  const unchanged =
    times >= NO_CHANGE_REPEAT_LIMIT &&
    repeats.slice(0, NO_CHANGE_REPEAT_LIMIT - 1).every((e) => !e.page_changed);
  return unchanged || times >= CHANGE_REPEAT_LIMIT
    ? { previous, times }
    : undefined;
}

// --- The decision ---

/** The decision function's answers, or the stop its failure comes to. */
type Asked =
  | { answers: Record<string, unknown>; stop?: undefined }
  | { answers?: undefined; stop: StepStop };

/** What a read of the answers came to, or the stop its failure comes to. */
type Read<T> =
  { value: T; stop?: undefined } | { value?: undefined; stop: StepStop };

const errorTextOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** How a `needs_value` Handover ends when the model could not pick a closed-set value. */
const pickYourself = (parameter: string) =>
  `Read the page again, pick "${parameter}" yourself and call the operation directly, or try a different approach.`;

/**
 * Decide one step: stage one asks which operation moves closest to the goal,
 * whether the goal is met, and which Goal Value each candidate would take;
 * stage two asks the chosen operation's arguments, with a run-off when several
 * chunks of a ref each named an element. Every verdict that ends the run
 * before an action is decided here, the repeat stop included.
 */
export async function decideStep({
  goal,
  values,
  history,
  capture,
  toolOptions,
  pomDefinitions,
  decide,
}: StepInput): Promise<StepVerdict> {
  // The step's scores, there once stage one is read; a stop after that
  // carries them.
  const step: { scores?: StepScores } = {};

  const stop = (
    reason: HandoverReason,
    next: string,
    needs?: HandoverNeeds
  ): StepStop => ({
    kind: "stop",
    reason,
    next,
    ...(needs ? { needs } : {}),
    ...(step.scores ? { scores: step.scores } : {}),
  });

  /**
   * A decision the loop could not obtain or use ends the run; `what` says what
   * went wrong and `failure` decides whether the advice includes a retry.
   */
  const decideFailed = (what: string, failure: DecisionFailure): StepStop =>
    stop(
      "decide_failed",
      `${asSentence(what)} ${isRetryableDecisionFailure(failure) ? "Retry, or handle" : "Handle"} the goal without the Goal Loop.`
    );

  /** The decision function threw; the error travels on. */
  const callFailed = (error: unknown): StepStop =>
    error instanceof DecisionEndpointError
      ? // Its message already says what the endpoint did.
        decideFailed(error.message, { kind: "endpoint", error })
      : decideFailed(`The decision function failed: ${errorTextOf(error)}`, {
          kind: "thrown",
        });

  /** The decision function answered with something the loop could not read. */
  const invalidDecision = (error: unknown): StepStop =>
    decideFailed(
      `The decision function's answers could not be read: ${errorTextOf(error)}`,
      { kind: "invalid" }
    );

  const ask = async (request: DecisionRequest): Promise<Asked> => {
    try {
      const response = await decide(request);
      return { answers: response.answers as Record<string, unknown> };
    } catch (error) {
      return { stop: callFailed(error) };
    }
  };

  const read = <T>(reader: () => T): Read<T> => {
    try {
      return { value: reader() };
    } catch (error) {
      return { stop: invalidDecision(error) };
    }
  };

  const state = buildStepState(
    goal,
    values,
    capture.tree,
    pomDefinitions,
    history
  );
  // Free values asked next to the operation, so stage two picks the element
  // with the value it will receive in view.
  const speculative = buildSpeculativeValueQuestions(toolOptions, values);

  // A question outside the limit is never sent, in either stage.
  if (!operationQuestionFits(toolOptions)) {
    return decideFailed(
      `The page offers ${toolOptions.length} operations, more than one decision can choose from`,
      { kind: "too-many-operations" }
    );
  }

  // --- Stage one: the operation, and whether the goal is met ---

  const stageOne = await ask(
    buildOperationRequest(state, toolOptions, speculative)
  );
  if (stageOne.stop) return stageOne.stop;
  const stageOneAnswers = read(() => ({
    operation: parseOperationAnswer(stageOne.answers),
    goalMet: parseGoalMetAnswer(stageOne.answers),
  }));
  if (stageOneAnswers.stop) return stageOneAnswers.stop;
  const { operation: operationAnswer, goalMet } = stageOneAnswers.value;

  const scores: StepScores = {
    operationProbabilities: operationAnswer.probabilities,
    goalMetScore: goalMet.noul,
  };
  step.scores = scores;

  // 1. done: goal_met >= 0.5
  if (goalMet.noul >= 0.5) {
    return stop(
      "done",
      "The goal has been achieved. Continue with your next task."
    );
  }

  // 2. no_fitting_option: model chose "none"
  const chosenKey = operationAnswer.choice;
  if (chosenKey === "none") {
    return stop(
      "no_fitting_option",
      "No available operation fits the goal on the current page. Navigate to a different page or try a different approach."
    );
  }

  const chosenOption = toolOptions.find((opt) => opt.key === chosenKey);
  if (!chosenOption) {
    return decideFailed(`The model chose an unknown operation "${chosenKey}"`, {
      kind: "unknown-choice",
    });
  }
  const chosenTool = chosenOption.tool;

  // The speculative answers that apply to the chosen operation. The scores
  // share the record's maps, so an answer that fails to read leaves the ones
  // read before it on the run result.
  const valueRecord: AnswerRecord = { choices: {}, probabilities: {} };
  scores.valueChoices = valueRecord.choices;
  scores.valueProbabilities = valueRecord.probabilities;
  const presets = read(() =>
    readSpeculativeValues(
      chosenTool,
      speculative,
      stageOne.answers,
      valueRecord
    )
  );
  if (presets.stop) return presets.stop;

  // 3. needs_value: the operation needs a value the model cannot pick
  const plan = planArguments(chosenTool, capture, values, presets.value);
  if (plan.kind === "needs_free_value") {
    return stop(
      "needs_value",
      `The operation "${chosenTool.name}" needs values for: ${plan.parameters.join(", ")}, and no Goal Value fits ${plan.unfilled.join(", ")}. Call goal again with a value for ${plan.unfilled.join(", ")} in values, or call ${chosenTool.name} directly.`,
      { tool: chosenTool.name, parameters: plan.parameters }
    );
  }
  if (plan.kind === "needs_ref_choice") {
    return stop(
      "needs_value",
      `The operation "${chosenTool.name}" acts on one element, and the loop found no element on the current page it applies to. ${pickYourself(plan.parameter)}`,
      { tool: chosenTool.name, parameters: [plan.parameter] }
    );
  }
  if (plan.kind === "needs_instance_choice") {
    return stop(
      "needs_value",
      `The operation "${chosenTool.name}" acts on a collection instance, and ${
        plan.optionCount === 0
          ? "the loop found no instance on the current page"
          : "the current page holds more of them than one decision can offer"
      }. ${pickYourself(plan.parameter)}`,
      { tool: chosenTool.name, parameters: [plan.parameter] }
    );
  }
  if (plan.kind === "needs_value_choice") {
    return stop(
      "needs_value",
      `The operation "${chosenTool.name}" needs a value for "${plan.parameter}", and its ${plan.optionCount} allowed values are not a choice one decision can answer. Provide the value and call the operation directly, or try a different approach.`,
      { tool: chosenTool.name, parameters: [plan.parameter] }
    );
  }

  // --- Stage two: the operation's arguments, asked in one parallel request ---

  let chosenArguments: ChosenArguments = {
    args: {},
    chosen: {},
    choices: {},
    probabilities: {},
    lists: {},
  };
  if (plan.questions.length > 0) {
    const argumentRecord: AnswerRecord = { choices: {}, probabilities: {} };
    scores.argumentChoices = argumentRecord.choices;
    scores.argumentProbabilities = argumentRecord.probabilities;
    const stageTwo = await ask(
      buildArgumentRequest(state, plan.questions, capture)
    );
    if (stageTwo.stop) return stageTwo.stop;
    const argumentAnswers = read(() =>
      readArgumentAnswers(
        chosenTool,
        plan.questions,
        stageTwo.answers,
        argumentRecord
      )
    );
    if (argumentAnswers.stop) return argumentAnswers.stop;
    const answers = argumentAnswers.value;

    // Every chunk of a ref over the cap answered "none of these": the step
    // ran no action, so it leaves no history entry.
    if (answers.kind === "none_fits") {
      return stop(
        "no_fitting_option",
        `No element on the current page fits the operation "${chosenTool.name}". Navigate to a different page or try a different approach.`
      );
    }

    // The model judged that no Goal Value fits a required parameter.
    if (answers.kind === "needs_value") {
      return stop(
        "needs_value",
        `The operation "${chosenTool.name}" needs a value for "${answers.parameter}", and the model judged that none of the Goal Values fits. Call goal again with a value for "${answers.parameter}" in values, or call ${chosenTool.name} directly.`,
        { tool: chosenTool.name, parameters: [answers.parameter] }
      );
    }

    // Several chunks each named an element: one run-off among exactly those.
    if (answers.kind === "run_off") {
      scores.runOff = true;
      const runOff = await ask(
        buildArgumentRequest(state, [answers.question], capture)
      );
      if (runOff.stop) return runOff.stop;
      const completed = read(() => readRunOffAnswer(answers, runOff.answers));
      if (completed.stop) return completed.stop;
      chosenArguments = completed.value;
    } else {
      chosenArguments = answers.chosen;
    }
    fitListsToTarget(chosenTool, chosenArguments, capture);
    scores.argumentChoices = chosenArguments.choices;
    scores.argumentProbabilities = chosenArguments.probabilities;
  }
  completeArguments(chosenTool, chosenArguments, presets.value);

  // 4. no_progress: the step would repeat the one before, to no effect.
  const stuck = stuckOn(history, chosenTool.name, chosenArguments.chosen);
  if (stuck) {
    return stop(
      "no_progress",
      `The loop is repeating ${stuck.previous.did}: it chose the same step ${stuck.times} times in a row${stuck.previous.page_changed ? "" : ", and the last run did not change the page"}. It stopped instead of running it again. Perform that step yourself by calling ${chosenTool.name}, or call goal again with a goal that names the element to act on.`,
      {
        tool: chosenTool.name,
        parameters: Object.keys(chosenArguments.chosen),
      }
    );
  }

  return {
    kind: "act",
    operation: chosenTool,
    args: chosenArguments.args,
    chosen: chosenArguments.chosen,
    scores,
  };
}
