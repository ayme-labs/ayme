import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  structuralPageChanged,
  waitForSettled,
} from "@ayme-dev/core/structural-observation";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import type { JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import { getPageContextForDocument, type PageContext } from "./pageContext";
import { getPageStateCaptureForDocument } from "./pageState";
import { renderPomDefinitions } from "./pomDefinitionText";
import { clickPageStateRefTool, fillPageStateRefTool } from "./refInteractions";
import { listRegisteredPomTools, probeRegisteredPomMembers } from "./registry";

export type GoalLoopDecisionFunction = (
  request: DecisionRequest
) => Promise<DecisionResponse>;

const DECISION_MODEL = "typesafe/jev-1.13";

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
const MAX_CHOICE_OPTIONS = 255;

// --- Public result types (match the fixed Handover interface from #82) ---

export type HandoverReason =
  | "done"
  | "no_fitting_option"
  | "needs_value"
  | "action_failed"
  | "step_budget"
  | "decide_failed";

export type HandoverHistoryEntry = {
  did: string;
  result: string;
  page_changed: boolean;
};

export type HandoverNeeds = {
  tool: string;
  parameters: string[];
};

export type Handover = {
  reason: HandoverReason;
  next: string;
  history: HandoverHistoryEntry[];
  needs?: HandoverNeeds;
};

// --- Tool option building ---

type ExecutableTool = {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
  /** Required parameter names; empty if the tool takes no arguments. */
  requiredParams: string[];
};

type ToolOption = {
  key: string;
  label: string;
  tool: ExecutableTool;
};

const RESERVED_KEYS = new Set(["none"]);

/**
 * Build the flat list of tool options offered to the model each step.
 * Includes Ref Tools, all registered POM tools, and validates that no
 * key collides with another tool or the reserved `"none"` sentinel.
 */
function buildToolOptions(): ToolOption[] {
  const refTools: ExecutableTool[] = [
    {
      name: clickPageStateRefTool.name,
      description: clickPageStateRefTool.description,
      execute: clickPageStateRefTool.execute,
      requiredParams: [...(clickPageStateRefTool.inputSchema.required ?? [])],
    },
    {
      name: fillPageStateRefTool.name,
      description: fillPageStateRefTool.description,
      execute: fillPageStateRefTool.execute,
      requiredParams: [...(fillPageStateRefTool.inputSchema.required ?? [])],
    },
  ];
  const pomTools: ExecutableTool[] = listRegisteredPomTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    execute: (input: unknown) => tool.execute(input),
    requiredParams: tool.parameters
      .filter((p) => !p.optional)
      .map((p) => p.name),
  }));

  const seen = new Set<string>();
  const options: ToolOption[] = [];
  for (const tool of [...refTools, ...pomTools]) {
    if (RESERVED_KEYS.has(tool.name) || seen.has(tool.name)) continue;
    seen.add(tool.name);
    options.push({ key: tool.name, label: tool.description, tool });
  }
  return options;
}

// --- Decision request building (ADR-0022: built in the browser) ---

/** Construct a `DecisionRequest` for one step of the Goal Loop. */
function buildStepRequest(
  goal: string,
  pageContext: PageContext,
  history: HandoverHistoryEntry[],
  toolOptions: ToolOption[]
): DecisionRequest {
  const criteria: Record<string, string> = {};
  for (const option of toolOptions) criteria[option.key] = option.label;
  criteria["none"] = "No available operation fits the goal right now.";

  const state: Record<string, unknown> = {
    goal,
    page: pageContext.structure,
    page_objects: renderPomDefinitions(pageContext.pomDefinitions),
    history,
  };

  const questions: Record<string, unknown> = {
    operation: {
      type: "choice",
      instructions: "Which operation moves closest to the goal?",
      criteria,
    },
    goal_met: {
      type: "noul",
      instructions: "Has the goal been fully achieved on the current page?",
    },
  };

  return { model: DECISION_MODEL, state, questions };
}

// --- Response parsing ---

type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

type NoulAnswer = {
  type: "noul";
  noul: number;
};

/** Extract and validate the `operation` choice answer from the model response. */
function parseOperationAnswer(answers: Record<string, unknown>): ChoiceAnswer {
  const raw = answers.operation;
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as Record<string, unknown>).type !== "choice" ||
    typeof (raw as Record<string, unknown>).choice !== "string"
  )
    throw new Error("Invalid operation answer from decision function.");
  return raw as ChoiceAnswer;
}

/** Extract and validate the `goal_met` noul answer from the model response. */
function parseGoalMetAnswer(answers: Record<string, unknown>): NoulAnswer {
  const raw = answers.goal_met;
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as Record<string, unknown>).type !== "noul" ||
    typeof (raw as Record<string, unknown>).noul !== "number"
  )
    throw new Error("Invalid goal_met answer from decision function.");
  return raw as NoulAnswer;
}

// --- Action execution (same sequence as direct tool calls) ---

/**
 * Execute a tool and determine whether the structural page state changed.
 * Uses the same capture → execute → settle → compare sequence as direct
 * tool calls (ADR-0024).
 */
async function executeToolAction(
  tool: ExecutableTool,
  currentDocument: Document
): Promise<{ result: string; page_changed: boolean }> {
  // Capture the tree before the action (decision tree)
  const beforeCapture = await getPageStateCaptureForDocument(currentDocument);

  // Execute
  await tool.execute({});

  // Wait for the page to settle
  await waitForSettled({
    activity: getBrowserPageActivitySource(currentDocument),
    clock: browserMonotonicClock,
    quietMs: SETTLED_PAGE_QUIET_MS,
    deadlineMs: SETTLED_PAGE_DEADLINE_MS,
  });

  // Capture after and compare
  const afterCapture = await getPageStateCaptureForDocument(currentDocument);
  const page_changed = structuralPageChanged(
    beforeCapture.tree,
    afterCapture.tree
  );

  return { result: "ok", page_changed };
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
      return (await pursueGoal(
        goal,
        maxSteps,
        decisionFn,
        currentDocument
      )) as JsonValue;
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
  throw new Error(
    "pursue_goal requires a string goal and an integer maxSteps."
  );
}

/**
 * Run the Goal Loop: iterate steps, asking the decision model which operation
 * to run and whether the goal is met, until a Handover condition is reached.
 *
 * Per-step scores (operation probabilities and `goal_met` noul) are recorded
 * in `stepScores` but are not part of the returned Handover.
 */
async function pursueGoal(
  goal: string,
  maxSteps: number,
  decisionFn: GoalLoopDecisionFunction,
  currentDocument: Document
): Promise<Handover> {
  const history: HandoverHistoryEntry[] = [];
  // Internal run result: scores per step (not exposed in tool result).
  const _stepScores: Array<{
    operationProbabilities?: Record<string, number>;
    goalMetScore: number;
  }> = [];
  void _stepScores; // ponytail: stored for future observability; not consumed yet
  let consecutiveFailures = 0;

  for (let step = 0; step < maxSteps; step++) {
    // Refresh POM observations so newly revealed/hidden roots are reflected.
    await probeRegisteredPomMembers();

    // Fresh page context each step
    const pageContext = await getPageContextForDocument(currentDocument);

    // Build tool options from currently available tools
    const toolOptions = buildToolOptions();

    // If total options (tools + none) exceed 255, we can't ask the model
    if (toolOptions.length + 1 > MAX_CHOICE_OPTIONS) {
      // needs_value with no specific tool — overflow case
      // Per ticket: "needs_value is also the result when a ref question would have more than 255 options: no call is made."
      // This applies to ref questions in stage two, but the same principle applies to operation overflow
      return {
        reason: "needs_value",
        next: "Too many operations are available. Narrow the page state or reduce Page Object registrations, then try again.",
        history,
      };
    }

    // Ask the model
    let response: DecisionResponse;
    try {
      const request = buildStepRequest(goal, pageContext, history, toolOptions);
      response = await decisionFn(request);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      return {
        reason: "decide_failed",
        next: `The decision function failed: ${errorText}. Retry, or handle the goal without the Goal Loop.`,
        history,
      };
    }

    // Parse answers
    let operationAnswer: ChoiceAnswer;
    let goalMetAnswer: NoulAnswer;
    try {
      operationAnswer = parseOperationAnswer(
        response.answers as Record<string, unknown>
      );
      goalMetAnswer = parseGoalMetAnswer(
        response.answers as Record<string, unknown>
      );
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      return {
        reason: "decide_failed",
        next: `The decision function returned an invalid response: ${errorText}. Retry, or handle the goal without the Goal Loop.`,
        history,
      };
    }

    // Record per-step scores internally (not part of the Handover).
    _stepScores.push({
      operationProbabilities: operationAnswer.probabilities,
      goalMetScore: goalMetAnswer.noul,
    });

    // --- Check handover reasons in order ---

    // 1. done: goal_met >= 0.5
    if (goalMetAnswer.noul >= 0.5) {
      return {
        reason: "done",
        next: "The goal has been achieved. Continue with your next task.",
        history,
      };
    }

    // 2. no_fitting_option: model chose "none"
    const chosenKey = operationAnswer.choice;
    if (chosenKey === "none") {
      return {
        reason: "no_fitting_option",
        next: "No available operation fits the goal on the current page. Navigate to a different page or try a different approach.",
        history,
      };
    }

    // Find the chosen tool
    const chosenOption = toolOptions.find((opt) => opt.key === chosenKey);
    if (!chosenOption) {
      return {
        reason: "decide_failed",
        next: `The model chose an unknown operation "${chosenKey}". Retry, or handle the goal without the Goal Loop.`,
        history,
      };
    }

    // 3. needs_value: the chosen tool has required parameters (stage one only — no args can be filled)
    if (chosenOption.tool.requiredParams.length > 0) {
      const requiredParams = chosenOption.tool.requiredParams;
      return {
        reason: "needs_value",
        next: `The operation "${chosenOption.tool.name}" needs values for: ${requiredParams.join(", ")}. Provide them and call the operation directly, or try a different approach.`,
        history,
        needs: {
          tool: chosenOption.tool.name,
          parameters: requiredParams,
        },
      };
    }

    // Execute the operation (same action sequence as direct tool calls)
    let actionResult: { result: string; page_changed: boolean };
    try {
      actionResult = await executeToolAction(
        chosenOption.tool,
        currentDocument
      );
      consecutiveFailures = 0;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      actionResult = { result: errorText, page_changed: false };
      consecutiveFailures++;
    }

    // Record history — `did` is a readable label, not only the tool name.
    history.push({
      did: chosenOption.label || chosenOption.tool.name,
      result: actionResult.result,
      page_changed: actionResult.page_changed,
    });

    // 4. action_failed: two failed actions in a row
    if (consecutiveFailures >= 2) {
      return {
        reason: "action_failed",
        next: "Two operations failed in a row. The page may be in an unexpected state. Inspect the page and try a different approach.",
        history,
      };
    }
  }

  // 5. step_budget
  return {
    reason: "step_budget",
    next: "The step budget was exhausted before the goal was achieved. Increase the budget or break the goal into smaller steps.",
    history,
  };
}
