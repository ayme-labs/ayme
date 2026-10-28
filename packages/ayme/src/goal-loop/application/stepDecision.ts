import {
  DecisionEndpointError,
  type DecisionFailure,
  type DecisionRequest,
  type DecisionResponse,
  isRetryableDecisionFailure,
} from "../domain/decisionWire";
import { asSentence } from "../../shared";
import type {
  ChosenOption,
  GoalLoopStepRecord,
  GoalValues,
  HandoverNeeds,
  HandoverReason,
} from "../../shared";
import type { PageCapture, PageStateCapture } from "../../page-state/domain";
import {
  buildArgumentRequest,
  buildOperationRequest,
  buildSpeculativeValueQuestions,
  buildStepState,
  completeArguments,
  describeLeftOut,
  fitListsToTarget,
  operationQuestionFits,
  parseGoalMetAnswer,
  parseGoalRemainingAnswer,
  parseOperationAnswer,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  readSpeculativeValues,
  type AnswerRecord,
  type ArgumentPlan,
  type ChosenArguments,
  type StageTwoQuestion,
  type StepState,
  type ValuePreset,
} from "../domain/goalLoopQuestions";
import type {
  GoalLoopOperation,
  ToolOption,
} from "../domain/goalLoopOperations";

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
  /** Stage one: how likely the goal still needs a step that has not run. */
  goalRemainingScore?: number;
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
  capture: PageCapture;
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

/**
 * The decision function's response, or the stop its failure comes to. Its
 * answers are taken out inside `read`, so a response without them is answers
 * the loop could not read, not a failed call.
 */
type Asked =
  | { response: DecisionResponse; stop?: undefined }
  | { response?: undefined; stop: StepStop };

const answersOf = (response: DecisionResponse) =>
  response.answers as Record<string, unknown>;

/** What a read of the answers came to, or the stop its failure comes to. */
type Read<T> =
  { value: T; stop?: undefined } | { value?: undefined; stop: StepStop };

/** The chosen operation's arguments, or the verdict that ends the step. */
type Decided =
  | { chosen: ChosenArguments; stop?: undefined }
  | { chosen?: undefined; stop: StepStop };

const errorTextOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * How one step asks and stops. A stop carries the step's scores once stage
 * one has set them.
 */
type StepAsker = {
  scores?: StepScores;
  stop(reason: HandoverReason, next: string, needs?: HandoverNeeds): StepStop;
  /**
   * A decision the loop could not obtain or use ends the run; `what` says
   * what went wrong and `failure` decides whether the advice includes a retry.
   */
  decideFailed(what: string, failure: DecisionFailure): StepStop;
  /** Ask the decision function; a throw becomes the stop it comes to. */
  ask(request: DecisionRequest): Promise<Asked>;
  /** Read answers; one the loop cannot read becomes the stop it comes to. */
  read<T>(reader: () => T): Read<T>;
};

function stepAsker(decide: GoalLoopDecisionFunction): StepAsker {
  const asker: StepAsker = {
    stop: (reason, next, needs) => ({
      kind: "stop",
      reason,
      next,
      ...(needs ? { needs } : {}),
      ...(asker.scores ? { scores: asker.scores } : {}),
    }),
    decideFailed: (what, failure) =>
      asker.stop(
        "decide_failed",
        `${asSentence(what)} ${isRetryableDecisionFailure(failure) ? "Retry, or handle" : "Handle"} the goal without the Goal Loop.`
      ),
    ask: async (request) => {
      try {
        return { response: await decide(request) };
      } catch (error) {
        return {
          stop:
            error instanceof DecisionEndpointError
              ? // Its message already says what the endpoint did.
                asker.decideFailed(error.message, { kind: "endpoint", error })
              : asker.decideFailed(
                  `The decision function failed: ${errorTextOf(error)}`,
                  { kind: "thrown" }
                ),
        };
      }
    },
    read: (reader) => {
      try {
        return { value: reader() };
      } catch (error) {
        return {
          stop: asker.decideFailed(
            `The decision function's answers could not be read: ${errorTextOf(error)}`,
            { kind: "invalid" }
          ),
        };
      }
    },
  };
  return asker;
}

/** How a `needs_value` Handover ends when the model could not pick a closed-set value. */
const pickYourself = (parameter: string) =>
  `Read the page again, pick "${parameter}" yourself and call the operation directly, or try a different approach.`;

/** The `needs_value` stop a plan that cannot ask the model comes to, worded. */
function planStop(
  tool: GoalLoopOperation,
  plan: Exclude<ArgumentPlan, { kind: "ask" }>,
  stop: StepAsker["stop"]
): StepStop {
  switch (plan.kind) {
    case "needs_free_value":
      return stop(
        "needs_value",
        `The operation "${tool.name}" needs values for: ${plan.parameters.join(", ")}, and no Goal Value fits ${plan.unfilled.join(", ")}. Call goal again with a value for ${plan.unfilled.join(", ")} in values, or call ${tool.name} directly.`,
        { tool: tool.name, parameters: plan.parameters }
      );
    case "needs_ref_choice":
      return stop(
        "needs_value",
        plan.unreachable
          ? `The operation "${tool.name}" acts on one element; ${plan.unreachable === 1 ? "1 element" : `${plan.unreachable} elements`} on the current page match it, and the operation would reach none of them.`
          : `The operation "${tool.name}" acts on one element, and the loop found no element on the current page it applies to. ${pickYourself(plan.parameter)}`,
        { tool: tool.name, parameters: [plan.parameter] }
      );
    case "needs_instance_choice":
      return stop(
        "needs_value",
        plan.optionCount > 0
          ? `The operation "${tool.name}" acts on a collection instance, and the current page holds more of them than one decision can offer. ${pickYourself(plan.parameter)}`
          : [
              `The operation "${tool.name}" acts on a collection instance, and the loop could offer none of its items.`,
              describeLeftOut(plan.leftOut),
              "Try a different approach.",
            ]
              .filter(Boolean)
              .join(" "),
        { tool: tool.name, parameters: [plan.parameter] }
      );
    case "needs_value_choice":
      return stop(
        "needs_value",
        `The operation "${tool.name}" needs a value for "${plan.parameter}", and its ${plan.optionCount} allowed values are not a choice one decision can answer. Provide the value and call the operation directly, or try a different approach.`,
        { tool: tool.name, parameters: [plan.parameter] }
      );
  }
}

/**
 * The chosen operation's arguments: planned from the page and the Goal
 * Values, asked in stage two when a parameter is left to the model, and
 * completed with the speculative values stage one already read.
 */
async function decideArguments(
  asker: StepAsker,
  scores: StepScores,
  tool: GoalLoopOperation,
  values: GoalValues | undefined,
  presets: readonly ValuePreset[],
  state: StepState,
  capture: PageStateCapture
): Promise<Decided> {
  // needs_value: the operation needs a value the model cannot pick
  const plan = planArguments(tool, capture, values, presets);
  if (plan.kind !== "ask") return { stop: planStop(tool, plan, asker.stop) };

  let chosen: ChosenArguments = {
    args: {},
    chosen: {},
    choices: {},
    probabilities: {},
    lists: {},
  };
  if (plan.questions.length > 0) {
    const asked = await askArguments(
      asker,
      scores,
      tool,
      plan.questions,
      state,
      capture
    );
    if (asked.stop) return asked;
    chosen = asked.chosen;
  }
  completeArguments(tool, chosen, presets);
  return { chosen };
}

/**
 * Stage two: the chosen operation's arguments, asked in one parallel request,
 * and a run-off when several chunks of a ref each named an element.
 */
async function askArguments(
  asker: StepAsker,
  scores: StepScores,
  tool: GoalLoopOperation,
  questions: readonly StageTwoQuestion[],
  state: StepState,
  capture: PageStateCapture
): Promise<Decided> {
  // The scores share the record's maps, so an answer that fails to read
  // leaves the ones read before it on the run result.
  const record: AnswerRecord = { choices: {}, probabilities: {} };
  scores.argumentChoices = record.choices;
  scores.argumentProbabilities = record.probabilities;
  const stageTwo = await asker.ask(
    buildArgumentRequest(state, questions, capture)
  );
  if (stageTwo.stop) return stageTwo;
  const read = asker.read(() =>
    readArgumentAnswers(tool, questions, answersOf(stageTwo.response), record)
  );
  if (read.stop) return read;
  const answers = read.value;

  // Every chunk of a ref over the cap answered "none of these": the step
  // ran no action, so it leaves no history entry.
  if (answers.kind === "none_fits") {
    return {
      stop: asker.stop(
        "no_fitting_option",
        [
          `No element on the current page fits the operation "${tool.name}".`,
          describeLeftOut(answers.leftOut),
          "Navigate to a different page or try a different approach.",
        ]
          .filter(Boolean)
          .join(" ")
      ),
    };
  }

  // The model judged that nothing offered fits a required parameter.
  if (answers.kind === "needs_value") {
    const { parameter, goalValuesOffered } = answers;
    return {
      stop: asker.stop(
        "needs_value",
        goalValuesOffered
          ? `The operation "${tool.name}" needs a value for "${parameter}", and the model judged that none of the Goal Values fits. Call goal again with a value for "${parameter}" in values, or call ${tool.name} directly.`
          : `The operation "${tool.name}" needs a value for "${parameter}", and the model judged that none of its allowed values belongs in it.`,
        { tool: tool.name, parameters: [parameter] }
      ),
    };
  }

  let chosen = answers.chosen;
  // Several chunks each named an element: one run-off among exactly those.
  if (answers.kind === "run_off") {
    scores.runOff = true;
    const runOff = await asker.ask(
      buildArgumentRequest(state, [answers.question], capture)
    );
    if (runOff.stop) return runOff;
    const completed = asker.read(() =>
      readRunOffAnswer(answers, answersOf(runOff.response))
    );
    if (completed.stop) return completed;
    chosen = completed.value;
  }
  fitListsToTarget(tool, chosen, capture);
  scores.argumentChoices = chosen.choices;
  scores.argumentProbabilities = chosen.probabilities;
  return { chosen };
}

/**
 * Decide one step: stage one asks which operation moves closest to the goal,
 * whether the goal is met, and which Goal Value each candidate would take;
 * stage two asks the chosen operation's arguments. Every verdict that ends
 * the run before an action is decided here, the repeat stop included.
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
  const asker = stepAsker(decide);
  const { stop } = asker;

  // A question outside the limit is never sent, in either stage.
  if (!operationQuestionFits(toolOptions)) {
    return asker.decideFailed(
      `The page offers ${toolOptions.length} operations, more than one decision can choose from`,
      { kind: "too-many-operations" }
    );
  }

  const state = buildStepState(goal, values, capture, pomDefinitions, history);
  // Free values asked next to the operation, so stage two picks the element
  // with the value it will receive in view.
  const speculative = buildSpeculativeValueQuestions(toolOptions, values);

  // --- Stage one: the operation, and whether the goal is met ---

  const stageOne = await asker.ask(
    buildOperationRequest(state, toolOptions, speculative)
  );
  if (stageOne.stop) return stageOne.stop;
  const stageOneAnswers = asker.read(() => ({
    operation: parseOperationAnswer(answersOf(stageOne.response)),
    goalMet: parseGoalMetAnswer(answersOf(stageOne.response)),
    goalRemaining: parseGoalRemainingAnswer(answersOf(stageOne.response)),
  }));
  if (stageOneAnswers.stop) return stageOneAnswers.stop;
  const {
    operation: operationAnswer,
    goalMet,
    goalRemaining,
  } = stageOneAnswers.value;

  const scores: StepScores = {
    operationProbabilities: operationAnswer.probabilities,
    goalMetScore: goalMet.noul,
    ...(goalRemaining ? { goalRemainingScore: goalRemaining.noul } : {}),
  };
  asker.scores = scores;
  const chosenKey = operationAnswer.choice;

  // 1. done: the model has nothing left to run, and either the page shows
  // the goal's end state or no step of the goal is outstanding. A chosen
  // operation always runs, whatever the goal_met score: the goal may end in
  // an effect the page never shows.
  const nothingToRun = chosenKey === "none";
  const endStateVisible = goalMet.noul >= 0.5;
  // A step that failed has not taken effect, so it stays outstanding
  // whatever the model answers; only the page can show the goal met then.
  const lastStep = history.at(-1);
  const lastStepFailed = lastStep !== undefined && lastStep.result !== "ok";
  const nothingOutstanding =
    !lastStepFailed && goalRemaining !== undefined && goalRemaining.noul < 0.5;
  if (nothingToRun && (endStateVisible || nothingOutstanding))
    return stop(
      "done",
      "The goal has been achieved. Continue with your next task."
    );

  // 2. no_fitting_option: model chose "none" with the goal not met
  if (chosenKey === "none")
    return stop(
      "no_fitting_option",
      "No available operation fits the goal on the current page. Navigate to a different page or try a different approach."
    );

  const chosenTool = toolOptions.find((opt) => opt.key === chosenKey)?.tool;
  if (!chosenTool)
    return asker.decideFailed(
      `The model chose an unknown operation "${chosenKey}"`,
      { kind: "unknown-choice" }
    );

  // The speculative answers that apply to the chosen operation, recorded as
  // they are read.
  const valueRecord: AnswerRecord = { choices: {}, probabilities: {} };
  scores.valueChoices = valueRecord.choices;
  scores.valueProbabilities = valueRecord.probabilities;
  const presets = asker.read(() =>
    readSpeculativeValues(
      chosenTool,
      speculative,
      answersOf(stageOne.response),
      valueRecord
    )
  );
  if (presets.stop) return presets.stop;

  // 3. needs_value, and stage two: the operation's arguments
  const decided = await decideArguments(
    asker,
    scores,
    chosenTool,
    values,
    presets.value,
    state,
    capture
  );
  if (decided.stop) return decided.stop;
  const chosenArguments = decided.chosen;

  // 4. no_progress: the step would repeat the one before, to no effect.
  const stuck = stuckOn(history, chosenTool.name, chosenArguments.chosen);
  if (stuck)
    return stop(
      "no_progress",
      `The loop is repeating ${stuck.previous.did}: it chose the same step ${stuck.times} times in a row${stuck.previous.page_changed ? "" : ", and the last run did not change the page"}. It stopped instead of running it again. Perform that step yourself by calling ${chosenTool.name}, or call goal again with a goal that names the element to act on.`,
      {
        tool: chosenTool.name,
        parameters: Object.keys(chosenArguments.chosen),
      }
    );

  return {
    kind: "act",
    operation: chosenTool,
    args: chosenArguments.args,
    chosen: chosenArguments.chosen,
    scores,
  };
}
