import type { StructuralTree } from "@ayme-dev/core/structural-observation";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import type { JsonValue } from "./contracts";
import type { ActionResult } from "./actionSequence";
import { getPageStateCaptureForDocument } from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
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
// --- Internal run result (per-step scores; not part of the Handover) ---

export type GoalLoopStepScore = {
  operationProbabilities?: Record<string, number>;
  goalMetScore: number;
};

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

/**
 * Build the flat list of tool options offered to the model each step.
 * Includes Ref Tools and all registered POM tools.
 */
function toExecutable(t: {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
  inputSchema: { required?: readonly string[] };
}): ExecutableTool {
  return {
    name: t.name,
    description: t.description,
    execute: t.execute,
    requiredParams: [...(t.inputSchema.required ?? [])],
  };
}

function buildToolOptions(): ToolOption[] {
  const refTools = [clickPageStateRefTool, fillPageStateRefTool].map(
    toExecutable
  );
  const pomTools: ExecutableTool[] = listRegisteredPomTools().map((t) => ({
    name: t.name,
    description: t.description,
    execute: (input: unknown) => t.execute(input),
    requiredParams: t.parameters.filter((p) => !p.optional).map((p) => p.name),
  }));

  return [...refTools, ...pomTools].map((tool) => ({
    key: tool.name,
    label: tool.description,
    tool,
  }));
}

// --- Decision request building (ADR-0022: built in the browser) ---

/** Serialize a StructuralTree to a JSON-safe representation (full typed tree). */
function serializeTree(tree: StructuralTree): unknown {
  const serializeNode = (node: {
    ref: string;
    role: string;
    name: string;
    state: Record<string, unknown>;
    cursorPointer: boolean;
    props: Record<string, string>;
    children: readonly unknown[];
  }): unknown => ({
    ref: node.ref,
    role: node.role,
    name: node.name,
    ...(Object.values(node.state).some((v) => v !== undefined)
      ? { state: node.state }
      : {}),
    ...(node.cursorPointer ? { cursorPointer: true } : {}),
    ...(Object.keys(node.props).length > 0 ? { props: node.props } : {}),
    children: node.children.map((child) =>
      typeof child === "string" ? child : serializeNode(child as typeof node)
    ),
  });
  return tree.getRootNodes().map(serializeNode);
}

/** Construct a `DecisionRequest` for one step of the Goal Loop. */
function buildStepRequest(
  goal: string,
  pageTree: StructuralTree,
  pomDefinitionsText: string,
  history: HandoverHistoryEntry[],
  toolOptions: ToolOption[]
): DecisionRequest {
  const criteria: Record<string, string> = {};
  for (const option of toolOptions) criteria[option.key] = option.label;
  criteria["none"] = "No available operation fits the goal right now.";

  const state: Record<string, unknown> = {
    goal,
    page: serializeTree(pageTree),
    page_objects: pomDefinitionsText,
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
    !Number.isFinite((raw as Record<string, unknown>).noul)
  )
    throw new Error("Invalid goal_met answer from decision function.");
  return raw as NoulAnswer;
}

// --- Action execution (delegates to the shared action sequence) ---

/**
 * Execute a tool and read the `ActionResult` it returns.
 * Every registered tool (POM tools, Ref Tools) already runs through
 * `completeAction` internally, so we just forward and interpret the result.
 */
async function executeToolAction(
  tool: ExecutableTool
): Promise<{ result: string; page_changed: boolean }> {
  const raw = await tool.execute({});
  const action = raw as ActionResult | undefined;
  return {
    result: "ok",
    page_changed: action?.page_changed ?? false,
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
      runResultStore.last = result;
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
  throw new Error(
    "pursue_goal requires a string goal and an integer maxSteps."
  );
}

/**
 * Run the Goal Loop: iterate steps, asking the decision model which operation
 * to run and whether the goal is met, until a Handover condition is reached.
 *
 * Returns a `GoalLoopRunResult` containing both the public Handover and the
 * internal per-step scores. The tool exposes only the Handover.
 */
async function pursueGoal(
  goal: string,
  maxSteps: number,
  decisionFn: GoalLoopDecisionFunction,
  currentDocument: Document
): Promise<GoalLoopRunResult> {
  const history: HandoverHistoryEntry[] = [];
  const stepScores: GoalLoopStepScore[] = [];
  let consecutiveFailures = 0;

  const done = (handover: Handover): GoalLoopRunResult => ({
    handover,
    stepScores,
  });

  for (let step = 0; step < maxSteps; step++) {
    // Refresh POM observations so newly revealed/hidden roots are reflected.
    await probeRegisteredPomMembers();

    // Capture the page state this step decides on and build tool options. The
    // model is a caller, so the tree it sees is the "before" of the step's
    // Change Record: a change made while it decides counts into page_changed.
    const { tree: decisionTree } = await getPageStateCaptureForDocument(
      currentDocument,
      { forCaller: true }
    );
    const pomDefinitionsText = renderPomDefinitions(
      getPomDefinitions().definitions
    );
    const toolOptions = buildToolOptions();

    // Ask the model
    let response: DecisionResponse;
    try {
      const request = buildStepRequest(
        goal,
        decisionTree,
        pomDefinitionsText,
        history,
        toolOptions
      );
      response = await decisionFn(request);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      return done({
        reason: "decide_failed",
        next: `The decision function failed: ${errorText}. Retry, or handle the goal without the Goal Loop.`,
        history,
      });
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
      return done({
        reason: "decide_failed",
        next: `The decision function returned an invalid response: ${errorText}. Retry, or handle the goal without the Goal Loop.`,
        history,
      });
    }

    // Record per-step scores internally (not part of the Handover).
    stepScores.push({
      operationProbabilities: operationAnswer.probabilities,
      goalMetScore: goalMetAnswer.noul,
    });

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

    // 3. needs_value: the chosen tool has required parameters (stage one only — no args can be filled)
    if (chosenOption.tool.requiredParams.length > 0) {
      const requiredParams = chosenOption.tool.requiredParams;
      return done({
        reason: "needs_value",
        next: `The operation "${chosenOption.tool.name}" needs values for: ${requiredParams.join(", ")}. Provide them and call the operation directly, or try a different approach.`,
        history,
        needs: {
          tool: chosenOption.tool.name,
          parameters: requiredParams,
        },
      });
    }

    // Execute the operation through the same action sequence as direct tool calls.
    let actionResult: { result: string; page_changed: boolean };
    try {
      actionResult = await executeToolAction(chosenOption.tool);
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
