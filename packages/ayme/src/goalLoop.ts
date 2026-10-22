import type { JsonSchema, JsonValue, ToolDescriptor } from "./contracts";
import { failedActionRecord, type ActionResult } from "./actionSequence";
import { renderChangeRecord } from "./changeRecord";
import type { StartChildRun, RunContext } from "./run";
import { cursors } from "./cursors";
import {
  getInteractionHistory,
  getPageStateCaptureForDocument,
} from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
import { renderPomDefinitions } from "./pomDefinitionText";
import { probeRegisteredPomMembers } from "./registry";
import { buildToolOptions } from "./goalLoopOperations";
import {
  type GoalLoopOperation,
  type GoalValues,
  MAX_GOAL_VALUES,
} from "./goalLoopQuestions";
import type {
  ChosenOption,
  GoalLoopStepRecord,
  Handover,
  HandoverHistoryEntry,
} from "./handover";
import {
  decideStep,
  type GoalLoopDecisionFunction,
  type StepScores,
} from "./stepDecision";
import { goalLoopRunResultKey } from "./goalLoopRunResultKey";

export type { GoalLoopDecisionFunction } from "./stepDecision";

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
 * The `goal` tool; `execute` runs the loop for a Run, whose Caller the
 * Handover hands control back to.
 */
export type GoalTool = ToolDescriptor & {
  inputSchema: JsonSchema;
  execute(input: unknown, context: RunContext): Promise<JsonValue>;
};

/**
 * Package-internal: returns the `goal` tool when `goalLoop` is
 * configured, `null` otherwise.
 */
export function getPursueGoalTool(): GoalTool | null {
  const fn = goalLoopStore.decisionFn;
  if (!fn) return null;
  if (typeof document === "undefined") return null;
  return createPursueGoalTool(fn, document);
}
// --- Internal run result (per-step scores; not part of the Handover) ---

/**
 * One step of the run result. A step that executed an action carries its step
 * record, the fields of its Handover history entry; one that ended before
 * acting carries only the scores.
 */
export type GoalLoopStepScore = StepScores | (StepScores & GoalLoopStepRecord);

export type GoalLoopRunResult = {
  handover: Handover;
  stepScores: GoalLoopStepScore[];
};

export type GoalLoopRunResultStore = { last?: GoalLoopRunResult };

/** Where the last run's result is kept; the testing entry reads it. */
const runResultStore: GoalLoopRunResultStore = ((
  globalThis as typeof globalThis & {
    [goalLoopRunResultKey]?: GoalLoopRunResultStore;
  }
)[goalLoopRunResultKey] ??= {});

// --- Action execution (delegates to the shared action sequence) ---

/** What one executed step came to: its history fields and its Change Record. */
type StepOutcome = Pick<
  GoalLoopStepRecord,
  "result" | "page_changed" | "returned"
> & {
  changes?: string;
  /** The URL the full page load the step started was for. */
  loading?: string;
};

/**
 * At most this many characters of a step's Change Record go into its history
 * entry, so that the history the model is sent grows by a bounded amount with
 * each step.
 */
export const MAX_STEP_CHANGES = 400;

/** Marks a step's Change Record that was cut to `MAX_STEP_CHANGES`. */
export const CHANGES_CUT_MARKER = "\n… (cut)";

/**
 * At most this many characters of a step's returned value, as JSON, go into
 * its history entry; a longer one is sent as a cut string.
 */
export const MAX_STEP_RETURNED = 200;

/**
 * The value an action returned, bounded for the history entry: a copy of the
 * value when its JSON fits, else its JSON cut to `MAX_STEP_RETURNED`. A copy,
 * so that a tool returning live application state cannot rewrite an earlier
 * entry, or grow it past the bound, by mutating it later.
 */
function boundedReturned(returned: JsonValue): JsonValue {
  const json = JSON.stringify(returned);
  if (json.length <= MAX_STEP_RETURNED) return JSON.parse(json) as JsonValue;
  return `${json.slice(0, MAX_STEP_RETURNED - CHANGES_CUT_MARKER.length)}${CHANGES_CUT_MARKER}`;
}

/**
 * A Change Record cut to `MAX_STEP_CHANGES` characters, the marker included:
 * at the last whole line that fits, or mid-line when not even one does.
 */
function cutChanges(changes: string): string {
  if (changes.length <= MAX_STEP_CHANGES) return changes;
  const kept = changes.slice(0, MAX_STEP_CHANGES - CHANGES_CUT_MARKER.length);
  const lineEnd = kept.lastIndexOf("\n");
  return `${lineEnd > 0 ? kept.slice(0, lineEnd) : kept}${CHANGES_CUT_MARKER}`;
}

/** Record an executed step; `did` is derived, e.g. `click(button "Add item")`. */
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
    ...(outcome.returned !== undefined
      ? { returned: boundedReturned(outcome.returned) }
      : {}),
    ...(outcome.changes ? { changes: cutChanges(outcome.changes) } : {}),
    did: `${operation}(${descriptions.join(", ")})`,
  };
}

/**
 * Execute a tool as a step, a child Run of the goal Run through `run`, and
 * read the `ActionResult` it returns.
 * Every registered tool (POM tools, Browser Tools, Custom Tools) runs, as the Goal Loop's model, through
 * `runAction` internally, so we just forward and interpret the result.
 */
async function executeToolAction(
  tool: GoalLoopOperation,
  args: Record<string, unknown>,
  run: StartChildRun
): Promise<StepOutcome> {
  const raw = await tool.execute(args, run);
  const action = raw as ActionResult | undefined;
  return {
    result: "ok",
    page_changed: action?.page_changed ?? false,
    // A null return says nothing; an actual value is the step's only trace
    // when its effect is not on the page.
    ...(action?.result != null ? { returned: action.result } : {}),
    ...(action?.changes ? { changes: action.changes } : {}),
    ...(action?.loading ? { loading: action.loading } : {}),
  };
}

// --- The loop ---

/** Create the `goal` tool bound to the given decision function and document. */
export function createPursueGoalTool(
  decisionFn: GoalLoopDecisionFunction,
  currentDocument: Document
): GoalTool {
  /** Runs the loop for the Run's Caller, which the Handover hands control back to. */
  const execute = async (
    input: unknown,
    context: RunContext
  ): Promise<JsonValue> => {
    const result = await pursueGoal(
      input as GoalInput,
      decisionFn,
      currentDocument,
      context
    );
    return result.handover as unknown as JsonValue;
  };
  return {
    name: "goal",
    description:
      "Drive the page toward a goal in steps. In each step a fast model chooses at most one operation to run. Pass in values anything the goal needs typed in, such as a name or a URL, each under a label of your own; the loop picks among them and never makes up a value. Returns a Handover: why the loop stopped, what it did, and what to do next.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        maxSteps: {
          type: "integer",
          minimum: 1,
          description:
            "The most steps the loop may take before it hands back with step_budget. Each step runs at most one operation on the page and may ask the model more than once to choose it.",
        },
        values: {
          type: "object",
          description:
            "Passed to the Goal Loop with the goal. Where the page has nothing to pick, such as text to type or a URL to open, the loop picks one of these by its label. It never makes up a value.",
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
          minProperties: 1,
          maxProperties: MAX_GOAL_VALUES,
        },
      },
      required: ["goal", "maxSteps"],
      additionalProperties: false,
    } as const,
    execute,
  };
}

/** The `goal` tool's input: what callers pass and what the loop reads. */
export type GoalInput = {
  goal: string;
  maxSteps: number;
  /** Goal Values: labelled strings or numbers the loop may pick from. */
  values?: GoalValues;
};

/**
 * Run the Goal Loop: each step reads the page, has the Step Decision say what
 * the step does, runs that operation and records it, until a Handover
 * condition is reached.
 *
 * Returns a `GoalLoopRunResult` containing both the public Handover and the
 * internal per-step scores, and records it as the last run. The `goal` tool
 * exposes only the Handover.
 */
export async function pursueGoal(
  { goal, maxSteps, values }: GoalInput,
  decisionFn: GoalLoopDecisionFunction,
  currentDocument: Document,
  { cursor, run: runChild }: RunContext
): Promise<GoalLoopRunResult> {
  const history: HandoverHistoryEntry[] = [];
  const stepScores: GoalLoopStepScore[] = [];
  const interactions = getInteractionHistory(currentDocument);
  let consecutiveFailures = 0;
  // The loop reads on the Caller's behalf with a fork of its cursor: each
  // step's capture and child Run move the fork, the Caller's cursor stays put
  // until the Handover.
  const loop = cursors.fork(cursor);
  const run: StartChildRun = (name, input, stepCursor = loop) =>
    runChild(name, input, stepCursor);

  /**
   * End the run. The Handover carries what changed from the page the Caller
   * last received to the page the loop last received, and moves the Caller's
   * cursor there; the fork is dropped with the run.
   */
  const done = async (handover: Handover): Promise<GoalLoopRunResult> => {
    const received = loop.current();
    if (received) {
      const from = interactions.received(cursor) ?? received;
      const changes = await interactions.readChange(from, received);
      cursor.move(received);
      if (changes.hasAnyChanges())
        handover.changes = renderChangeRecord(changes, {
          before: interactions.pomLabels(from),
          after: interactions.pomLabels(received),
        });
    }
    const result = { handover, stepScores };
    runResultStore.last = result;
    return result;
  };

  for (let step = 0; step < maxSteps; step++) {
    // Refresh POM observations so newly revealed/hidden roots are reflected.
    await probeRegisteredPomMembers();

    // Capture the page state this step decides on. The model reads with the
    // fork, so the tree it sees is the "before" of the step's Change Record: a
    // change made while it decides counts into page_changed. The Caller's
    // cursor stays put until the Handover.
    const capture = await getPageStateCaptureForDocument(currentDocument, {
      cursor: loop,
    });
    const verdict = await decideStep({
      goal,
      values,
      history,
      capture,
      toolOptions: buildToolOptions(),
      pomDefinitions: renderPomDefinitions(getPomDefinitions().definitions),
      decide: decisionFn,
    });
    // Per-step scores are recorded internally (not part of the Handover).
    if (verdict.scores) stepScores.push(verdict.scores);
    if (verdict.kind === "stop") {
      return done({
        reason: verdict.reason,
        next: verdict.next,
        history,
        ...(verdict.needs ? { needs: verdict.needs } : {}),
      });
    }
    const { operation, scores } = verdict;

    // Execute the operation through the same action sequence as direct tool calls.
    let actionResult: StepOutcome;
    try {
      actionResult = await executeToolAction(operation, verdict.args, run);
      consecutiveFailures = 0;
    } catch (error) {
      // A failed step's Change Record goes through the history's bound, not
      // its error text.
      const failed = failedActionRecord(error);
      if (failed) {
        const { message, ...record } = failed;
        actionResult = { result: message, ...record };
      } else {
        const errorText =
          error instanceof Error ? error.message : String(error);
        actionResult = { result: errorText, page_changed: false };
      }
      consecutiveFailures++;
    }

    // One record for the Handover, the run result and the model's state.
    const record = stepRecord(operation.name, verdict.chosen, actionResult);
    history.push(record);
    Object.assign(scores, record);
    // The run result keeps the step's Change Record in full.
    if (actionResult.changes) scores.changes = actionResult.changes;

    // A step that started a full page load is the last: the loop ends with
    // the document it runs in.
    if (actionResult.loading) {
      return done({
        reason: "page_loading",
        next: `${record.did} started loading ${actionResult.loading}. Call snapshot next to read the new page.`,
        history,
        loading: actionResult.loading,
      });
    }

    // action_failed: two failed actions in a row
    if (consecutiveFailures >= 2) {
      return done({
        reason: "action_failed",
        next: "Two operations failed in a row. The page may be in an unexpected state. Inspect the page and try a different approach.",
        history,
      });
    }
  }

  // step_budget
  return done({
    reason: "step_budget",
    next: "The step budget was exhausted before the goal was achieved. Increase the budget or break the goal into smaller steps.",
    history,
  });
}
