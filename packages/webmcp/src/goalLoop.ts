import type { ModelContextTool } from "@mcp-b/webmcp-types";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import type { JsonValue } from "./contracts";
import type { ActionResult } from "./actionSequence";
import { renderChangeRecord } from "./changeRecord";
import {
  getInteractionHistory,
  getPageStateCaptureForDocument,
} from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
import { renderPomDefinitions } from "./pomDefinitionText";
import { probeRegisteredPomMembers } from "./registry";
import {
  buildArgumentRequest,
  buildOperationRequest,
  buildStepState,
  buildToolOptions,
  operationQuestionFits,
  parseGoalMetAnswer,
  parseOperationAnswer,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  type AnswerRecord,
  type ArgumentAnswers,
  type ChoiceAnswer,
  type ChosenArguments,
  type ChosenOption,
  type ExecutableTool,
  type NoulAnswer,
} from "./goalLoopQuestions";
import { ToolInputError } from "./errors";

export type GoalLoopDecisionFunction = (
  request: DecisionRequest
) => Promise<DecisionResponse>;

// --- Module-level goal loop configuration (parallel to configurePageStateIgnore) ---

type GoalLoopStore = { decisionFn?: GoalLoopDecisionFunction };

const goalLoopStore: GoalLoopStore = ((
  globalThis as typeof globalThis & {
    __aymeGoalLoopStore?: GoalLoopStore;
  }
).__aymeGoalLoopStore ??= {});

/**
 * Package-internal: store or clear the decision function for the current
 * runtime session. Called by `start()` and `stop()` in `runtime.ts`.
 */
export function configureGoalLoop(
  decisionFn: GoalLoopDecisionFunction | undefined
): void {
  goalLoopStore.decisionFn = decisionFn;
}

/**
 * Package-internal: returns the `pursue_goal` tool when `goalLoop` is
 * configured, `null` otherwise. Called by `synchronizeWebMcpTools`.
 */
export function getPursueGoalTool(): ModelContextTool<
  Record<string, unknown>,
  JsonValue
> | null {
  const fn = goalLoopStore.decisionFn;
  if (!fn) return null;
  if (typeof document === "undefined") return null;
  return createPursueGoalTool(fn, document);
}
// --- Internal run result (per-step scores; not part of the Handover) ---

/** What the model's answers scored in one step. */
type GoalLoopStepScores = {
  operationProbabilities?: Record<string, number>;
  goalMetScore: number;
  /**
   * Stage two, per question id: the key of the option chosen for every
   * argument question answered, chunks and run-off included.
   */
  argumentChoices?: Record<string, string>;
  /** Stage two, per question id: the scores the decision function supplied. */
  argumentProbabilities?: Record<string, Record<string, number>>;
  /**
   * The executed step's Change Record, as its action result carried it: the
   * page the model decided on against the Settled Page after the action.
   * Recorded, not sent; absent when the step ran no action or nothing changed.
   */
  changes?: string;
};

/**
 * One step of the run result. A step that executed an action carries its step
 * record, the fields of its Handover history entry; one that ended before
 * acting carries only the scores.
 */
export type GoalLoopStepScore =
  GoalLoopStepScores | (GoalLoopStepScores & GoalLoopStepRecord);

export type GoalLoopRunResult = {
  handover: Handover;
  stepScores: GoalLoopStepScore[];
};

type RunResultStore = { last?: GoalLoopRunResult };

const runResultStore: RunResultStore = ((
  globalThis as typeof globalThis & {
    __aymeGoalLoopRunResultStore?: RunResultStore;
  }
).__aymeGoalLoopRunResultStore ??= {});

/** Package-internal: access the last Goal Loop run result (scores + handover). */
export function getLastGoalLoopRunResult(): GoalLoopRunResult | undefined {
  return runResultStore.last;
}

// --- Public result types (match the fixed Handover interface from #82) ---

export type HandoverReason =
  | "done"
  | "no_fitting_option"
  | "needs_value"
  | "action_failed"
  | "step_budget"
  | "decide_failed";

/**
 * One executed step, as the loop knew it at the step. The same record is a
 * Handover's `history` entry, an entry of the `history` the model is sent, and
 * the base of the step's run record.
 */
export type GoalLoopStepRecord = {
  /** The tool's name; a Page Object tool's is its qualified name. */
  operation: string;
  /** Per parameter asked: the option the model chose, exactly as offered. */
  chosen: Record<string, ChosenOption>;
  /** `"ok"`, or the error the action failed with. */
  result: string;
  page_changed: boolean;
  /** A one-line label derived from the fields above; nothing reads it back. */
  did: string;
};

export type HandoverHistoryEntry = GoalLoopStepRecord;

export type HandoverNeeds = {
  tool: string;
  parameters: string[];
};

export type Handover = {
  reason: HandoverReason;
  next: string;
  history: HandoverHistoryEntry[];
  needs?: HandoverNeeds;
  /**
   * The run's Change Record: the page the calling agent last received against
   * the page the loop last received, in the notation of `ActionResult.changes`.
   * Absent when nothing changed.
   */
  changes?: string;
};

// --- Action execution (delegates to the shared action sequence) ---

/** What one executed step came to: its history fields and its Change Record. */
type StepOutcome = Pick<GoalLoopStepRecord, "result" | "page_changed"> & {
  changes?: string;
};

/** Record an executed step; `did` is derived, e.g. `click_page_state_ref(button "Add item")`. */
function stepRecord(
  operation: string,
  chosen: Record<string, ChosenOption>,
  outcome: StepOutcome
): GoalLoopStepRecord {
  const descriptions = Object.values(chosen).map(
    (option) => option.description
  );
  return {
    operation,
    chosen,
    result: outcome.result,
    page_changed: outcome.page_changed,
    did: `${operation}(${descriptions.join(", ")})`,
  };
}

/**
 * Execute a tool and read the `ActionResult` it returns.
 * Every registered tool (POM tools, Ref Tools) runs, as the Goal Loop's model, through
 * `runAction` internally, so we just forward and interpret the result.
 */
async function executeToolAction(
  tool: ExecutableTool,
  args: Record<string, unknown>
): Promise<StepOutcome> {
  const raw = await tool.execute(args);
  const action = raw as ActionResult | undefined;
  return {
    result: "ok",
    page_changed: action?.page_changed ?? false,
    ...(action?.changes ? { changes: action.changes } : {}),
  };
}

// --- The loop ---

/** Create the `pursue_goal` ModelContextTool bound to the given decision function and document. */
export function createPursueGoalTool(
  decisionFn: GoalLoopDecisionFunction,
  currentDocument: Document
): ModelContextTool<Record<string, unknown>, JsonValue> {
  return {
    name: "pursue_goal",
    description:
      "Drive the page toward a goal in steps. Each step is one fast model judgement. Returns a Handover: why the loop stopped, what it did, and what to do next.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        maxSteps: { type: "integer" },
      },
      required: ["goal", "maxSteps"],
      additionalProperties: false,
    } as const,
    execute: async (input: unknown): Promise<JsonValue> => {
      const { goal, maxSteps } = readPursueGoalInput(input);
      const result = await pursueGoal(
        goal,
        maxSteps,
        decisionFn,
        currentDocument
      );
      return result.handover as unknown as JsonValue;
    },
  };
}

/** Validate and narrow the raw `pursue_goal` input to typed fields. */
function readPursueGoalInput(input: unknown): {
  goal: string;
  maxSteps: number;
} {
  if (
    typeof input === "object" &&
    input !== null &&
    "goal" in input &&
    typeof input.goal === "string" &&
    "maxSteps" in input &&
    typeof input.maxSteps === "number" &&
    Number.isInteger(input.maxSteps)
  )
    return { goal: input.goal, maxSteps: input.maxSteps };
  throw new ToolInputError(
    "pursue_goal requires a string goal and an integer maxSteps."
  );
}

/**
 * Run the Goal Loop: iterate steps, asking the decision model which operation
 * to run, whether the goal is met, and — when the operation has arguments the
 * model may pick from closed sets — what to fill them with, until a Handover
 * condition is reached.
 *
 * Returns a `GoalLoopRunResult` containing both the public Handover and the
 * internal per-step scores, and records it as the last run. The published
 * tool and the runtime session's `pursueGoal` expose only the Handover.
 */
export async function pursueGoal(
  goal: string,
  maxSteps: number,
  decisionFn: GoalLoopDecisionFunction,
  currentDocument: Document
): Promise<GoalLoopRunResult> {
  const history: HandoverHistoryEntry[] = [];
  const stepScores: GoalLoopStepScore[] = [];
  const interactions = getInteractionHistory(currentDocument);
  let consecutiveFailures = 0;

  /**
   * End the run. The Handover moves the agent's cursor to the page the loop
   * last received and carries what changed since the agent's previous one.
   */
  const done = async (handover: Handover): Promise<GoalLoopRunResult> => {
    const changes = await interactions.handOver();
    if (changes?.hasAnyChanges())
      handover.changes = renderChangeRecord(changes);
    const result = { handover, stepScores };
    runResultStore.last = result;
    return result;
  };

  const errorTextOf = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  /** How a `needs_value` Handover ends when the model could not pick a closed-set value. */
  const pickYourself = (parameter: string) =>
    `Read the page context, pick "${parameter}" yourself and call the operation directly, or try a different approach.`;

  /** A decision the loop could not obtain ends the run; the error travels on. */
  const decideFailed = (error: unknown): Promise<GoalLoopRunResult> =>
    done({
      reason: "decide_failed",
      next: `The decision function failed: ${errorTextOf(error)}. Retry, or handle the goal without the Goal Loop.`,
      history,
    });

  /** A decision the loop could not use ends the run the same way. */
  const invalidDecision = (error: unknown): Promise<GoalLoopRunResult> =>
    done({
      reason: "decide_failed",
      next: `The decision function returned an invalid response: ${errorTextOf(error)}. Retry, or handle the goal without the Goal Loop.`,
      history,
    });

  for (let step = 0; step < maxSteps; step++) {
    // Refresh POM observations so newly revealed/hidden roots are reflected.
    await probeRegisteredPomMembers();

    // Capture the page state this step decides on and build tool options. The
    // model is a caller with its own cursor, so the tree it sees is the
    // "before" of the step's Change Record: a change made while it decides
    // counts into page_changed. The calling agent's cursor stays put until the
    // Handover.
    // Both stages of the step are decided on this one capture, so the refs the
    // model reads in the page are the refs the ref options offer.
    const capture = await getPageStateCaptureForDocument(currentDocument, {
      receivedBy: "goalLoop",
    });
    const state = buildStepState(
      goal,
      capture.tree,
      renderPomDefinitions(getPomDefinitions().definitions),
      history
    );
    const toolOptions = buildToolOptions();

    // A question outside the limit is never sent, in either stage.
    if (!operationQuestionFits(toolOptions)) {
      return done({
        reason: "decide_failed",
        next: `The page offers ${toolOptions.length} operations, more than one decision can choose from. Read the page context and call the tools you need directly.`,
        history,
      });
    }

    // --- Stage one: the operation, and whether the goal is met ---

    let stageOne: DecisionResponse;
    try {
      stageOne = await decisionFn(buildOperationRequest(state, toolOptions));
    } catch (error) {
      return decideFailed(error);
    }

    let operationAnswer: ChoiceAnswer;
    let goalMetAnswer: NoulAnswer;
    try {
      const answers = stageOne.answers as Record<string, unknown>;
      operationAnswer = parseOperationAnswer(answers);
      goalMetAnswer = parseGoalMetAnswer(answers);
    } catch (error) {
      return invalidDecision(error);
    }

    // Record per-step scores internally (not part of the Handover).
    const score: GoalLoopStepScores = {
      operationProbabilities: operationAnswer.probabilities,
      goalMetScore: goalMetAnswer.noul,
    };
    stepScores.push(score);

    // --- Check handover reasons in order ---

    // 1. done: goal_met >= 0.5
    if (goalMetAnswer.noul >= 0.5) {
      return done({
        reason: "done",
        next: "The goal has been achieved. Continue with your next task.",
        history,
      });
    }

    // 2. no_fitting_option: model chose "none"
    const chosenKey = operationAnswer.choice;
    if (chosenKey === "none") {
      return done({
        reason: "no_fitting_option",
        next: "No available operation fits the goal on the current page. Navigate to a different page or try a different approach.",
        history,
      });
    }

    // Find the chosen tool
    const chosenOption = toolOptions.find((opt) => opt.key === chosenKey);
    if (!chosenOption) {
      return done({
        reason: "decide_failed",
        next: `The model chose an unknown operation "${chosenKey}". Retry, or handle the goal without the Goal Loop.`,
        history,
      });
    }
    const chosenTool = chosenOption.tool;

    // 3. needs_value: the operation needs a value the model cannot pick
    const plan = planArguments(chosenTool, capture);
    if (plan.kind === "needs_free_value") {
      return done({
        reason: "needs_value",
        next: `The operation "${chosenTool.name}" needs values for: ${plan.parameters.join(", ")}. Provide them and call the operation directly, or try a different approach.`,
        history,
        needs: { tool: chosenTool.name, parameters: plan.parameters },
      });
    }
    if (plan.kind === "needs_ref_choice") {
      return done({
        reason: "needs_value",
        next: `The operation "${chosenTool.name}" acts on one element, and the loop found no element on the current page it applies to. ${pickYourself(plan.parameter)}`,
        history,
        needs: { tool: chosenTool.name, parameters: [plan.parameter] },
      });
    }
    if (plan.kind === "needs_instance_choice") {
      return done({
        reason: "needs_value",
        next: `The operation "${chosenTool.name}" acts on a collection instance, and ${
          plan.optionCount === 0
            ? "the loop found no instance on the current page"
            : "the current page holds more of them than one decision can offer"
        }. ${pickYourself(plan.parameter)}`,
        history,
        needs: { tool: chosenTool.name, parameters: [plan.parameter] },
      });
    }
    if (plan.kind === "needs_value_choice") {
      return done({
        reason: "needs_value",
        next: `The operation "${chosenTool.name}" needs a value for "${plan.parameter}", and its ${plan.optionCount} allowed values are not a choice one decision can answer. Provide the value and call the operation directly, or try a different approach.`,
        history,
        needs: { tool: chosenTool.name, parameters: [plan.parameter] },
      });
    }

    // --- Stage two: the operation's arguments, asked in one parallel request ---

    let chosenArguments: ChosenArguments = {
      args: {},
      chosen: {},
      choices: {},
      probabilities: {},
    };
    if (plan.questions.length > 0) {
      // The step score shares the record's maps, so an answer that fails to
      // read leaves the ones read before it on the run result.
      const record: AnswerRecord = { choices: {}, probabilities: {} };
      score.argumentChoices = record.choices;
      score.argumentProbabilities = record.probabilities;
      let stageTwo: DecisionResponse;
      try {
        stageTwo = await decisionFn(
          buildArgumentRequest(state, plan.questions)
        );
      } catch (error) {
        return decideFailed(error);
      }
      let argumentAnswers: ArgumentAnswers;
      try {
        argumentAnswers = readArgumentAnswers(
          chosenTool,
          plan.questions,
          stageTwo.answers as Record<string, unknown>,
          record
        );
      } catch (error) {
        return invalidDecision(error);
      }

      // Every chunk of a ref over the cap answered "none of these": the step
      // ran no action, so it leaves no history entry (#123).
      if (argumentAnswers.kind === "none_fits") {
        return done({
          reason: "no_fitting_option",
          next: `No element on the current page fits the operation "${chosenTool.name}". Navigate to a different page or try a different approach.`,
          history,
        });
      }

      // Several chunks each named an element: one run-off among exactly those.
      if (argumentAnswers.kind === "run_off") {
        let runOff: DecisionResponse;
        try {
          runOff = await decisionFn(
            buildArgumentRequest(state, [argumentAnswers.question])
          );
        } catch (error) {
          return decideFailed(error);
        }
        try {
          chosenArguments = readRunOffAnswer(
            argumentAnswers,
            runOff.answers as Record<string, unknown>
          );
        } catch (error) {
          return invalidDecision(error);
        }
      } else {
        chosenArguments = argumentAnswers.chosen;
      }
      score.argumentChoices = chosenArguments.choices;
      score.argumentProbabilities = chosenArguments.probabilities;
    }

    // Execute the operation through the same action sequence as direct tool calls.
    let actionResult: StepOutcome;
    try {
      actionResult = await executeToolAction(chosenTool, chosenArguments.args);
      consecutiveFailures = 0;
      if (actionResult.changes) score.changes = actionResult.changes;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      actionResult = { result: errorText, page_changed: false };
      consecutiveFailures++;
    }

    // One record for the Handover, the run result and the model's state.
    const record = stepRecord(
      chosenTool.name,
      chosenArguments.chosen,
      actionResult
    );
    history.push(record);
    Object.assign(score, record);

    // 4. action_failed: two failed actions in a row
    if (consecutiveFailures >= 2) {
      return done({
        reason: "action_failed",
        next: "Two operations failed in a row. The page may be in an unexpected state. Inspect the page and try a different approach.",
        history,
      });
    }
  }

  // 5. step_budget
  return done({
    reason: "step_budget",
    next: "The step budget was exhausted before the goal was achieved. Increase the budget or break the goal into smaller steps.",
    history,
  });
}
