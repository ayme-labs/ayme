/**
 * Test support for the Step Decision: pages of buttons, the operations a step
 * chooses between, and a scripted decision function that answers each request
 * `decideStep` sends it and keeps the requests.
 */
import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";
import type { GoalLoopStepRecord, JsonSchema } from "../../shared";
import type { DecisionRequest, DecisionResponse } from "../domain/decisionWire";
import type { PageCapture, PageStateCapture } from "../../page-state/domain";
import type { RootedToolInstance } from "../../page-objects/application";
import type { PageObjectId } from "../../page-objects/domain";
import {
  NONE_OF_THESE_KEY,
  NO_VALUE_NEEDED_KEY,
} from "../domain/goalLoopQuestions";
import {
  specsOfParameters,
  type GoalLoopOperation,
  type ToolOption,
} from "../domain/goalLoopOperations";
import {
  decideStep,
  type GoalLoopDecisionFunction,
  type StepInput,
} from "../application/stepDecision";

// --- Fixtures ---

/** A capture of `count` buttons in document order, refs e1..e<count>. */
export function captureOfButtons(count: number): PageCapture {
  const yaml = Array.from(
    { length: count },
    (_, index) => `- button "Item ${index + 1}" [ref=e${index + 1}]`
  ).join("\n");
  const tree = StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
  return { tree, pomRootMarks: new Map() };
}

/**
 * The closed set of a ref any node of the capture may fill: `step` replaces
 * it with the nodes of the step's own capture.
 */
export const everyNode: readonly StructuralNode[] = [];

/** The nodes of `capture`, in tree order, that `keep` keeps. */
export function nodesOf(
  capture: PageStateCapture,
  keep: (node: StructuralNode) => boolean = () => true
): StructuralNode[] {
  const nodes: StructuralNode[] = [];
  const pending = [...capture.tree.getRootNodes()].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (keep(node)) nodes.push(node);
    for (const child of [...node.children].reverse())
      if (typeof child !== "string") pending.push(child);
  }
  return nodes;
}

/** A required ref any element of the page may fill. */
export const refArg = {
  name: "ref",
  path: ["ref"],
  optional: false,
  closedSet: { kind: "ref", nodes: everyNode, unreachable: 0 },
} as const;

/** `tool` with the nodes of `capture` in each ref closed set `refArg` stands for. */
export function toolWithNodes(
  tool: GoalLoopOperation,
  capture: PageStateCapture
): GoalLoopOperation {
  return {
    ...tool,
    args: tool.args.map((arg) =>
      arg.closedSet?.kind === "ref" && arg.closedSet.nodes === everyNode
        ? { ...arg, closedSet: { ...arg.closedSet, nodes: nodesOf(capture) } }
        : arg
    ),
  };
}

/** `option` with the nodes of `capture` in each ref closed set `refArg` stands for. */
function withCapturedNodes(
  option: ToolOption,
  capture: PageStateCapture
): ToolOption {
  return { ...option, tool: toolWithNodes(option.tool, capture) };
}

export const clickTool: GoalLoopOperation = {
  name: "click",
  description: "Click an element.",
  execute: async () => null,
  requiredParams: ["ref"],
  args: [refArg],
};

export const saveTool: GoalLoopOperation = {
  name: "Form.save",
  description: "Save the form.",
  execute: async () => null,
  requiredParams: [],
  args: [],
};

/** An operation with a required free string parameter. */
export const renameTool: GoalLoopOperation = {
  name: "Project.rename",
  description: "Rename the project.",
  execute: async () => null,
  requiredParams: ["name"],
  args: [
    {
      name: "name",
      path: ["name"],
      optional: false,
      closedSet: null,
      free: ["string"],
    },
  ],
};

/** A single-element tool with a boolean parameter next to its ref. */
export const forceClickTool: GoalLoopOperation = {
  ...clickTool,
  name: "force_click",
  requiredParams: ["ref", "force"],
  args: [
    ...clickTool.args,
    {
      name: "force",
      path: ["force"],
      optional: false,
      closedSet: { kind: "values", values: [true, false] },
    },
  ],
};

/**
 * A single-element tool whose other closed-set parameters are named like the
 * first chunk and the run-off of its `ref` would be under a naive
 * `<parameter>_<suffix>`.
 */
export const lookalikeClickTool: GoalLoopOperation = {
  ...clickTool,
  name: "lookalike_click",
  requiredParams: ["ref", "ref_1", "ref_run_off"],
  args: [
    refArg,
    {
      name: "ref_1",
      path: ["ref_1"],
      optional: false,
      closedSet: { kind: "values", values: ["left", "right"] },
    },
    {
      name: "ref_run_off",
      path: ["ref_run_off"],
      optional: false,
      closedSet: { kind: "values", values: [true, false] },
    },
  ],
};

/** A collection item as a test writes it: `archiveTool` gives it its Page Object id. */
export type TestRoot = Omit<RootedToolInstance, "id">;

/** A collection item the tool is unavailable on, so never offered. */
export const archivedItem: TestRoot = {
  ref: "e99",
  present: true,
  available: false,
  reason: "already archived",
};

/**
 * A tool that goes through a collection, one instance per button of the
 * capture, plus any `unavailable` items.
 */
export const collectionTool = (
  capture: PageStateCapture,
  unavailable: TestRoot[] = []
): GoalLoopOperation =>
  archiveTool([
    ...capture.tree.getAllRefs().map((ref) => ({
      ref,
      present: true,
      available: true,
    })),
    ...unavailable,
  ]);

/**
 * A tool that goes through a collection over exactly `roots`, in their
 * order, so items left out can come before the ones offered. The item at
 * index `n - 1` has the Page Object id `po<n>`.
 */
export const archiveTool = (roots: readonly TestRoot[]): GoalLoopOperation => ({
  name: "List.archive",
  className: "List",
  description: "Archive an item.",
  execute: async () => null,
  requiredParams: ["id"],
  args: [
    {
      name: "id",
      path: ["id"],
      optional: false,
      closedSet: {
        kind: "instance",
        roots: roots.map((root, index) => ({
          ...root,
          id: `po${index + 1}` as PageObjectId,
        })),
      },
    },
  ],
});

/** An operation named `act` with the one parameter `param`, read from `schema`. */
export function actionWith(
  schema: JsonSchema,
  optional = false
): GoalLoopOperation {
  const parameters = [{ name: "param", optional, schema }];
  return {
    name: "act",
    description: "Act on the page.",
    execute: async () => null,
    requiredParams: optional ? [] : ["param"],
    args: specsOfParameters(parameters),
  };
}

export const optionOf = (tool: GoalLoopOperation): ToolOption => ({
  key: tool.name,
  label: tool.description,
  tool,
});

// --- Scripted decision function ---

/** What one request is answered with: answers per question id, or a failure. */
export type Turn =
  | { answers: Record<string, unknown> }
  | { answer: (request: DecisionRequest) => Record<string, unknown> }
  | { responds: unknown }
  | { throws: unknown };

/**
 * A decision function that answers each request with the next turn, and keeps
 * the requests it was sent. A request past the last turn fails the test.
 */
export function scripted(...turns: Turn[]) {
  const requests: DecisionRequest[] = [];
  const decide: GoalLoopDecisionFunction = async (
    request
  ): Promise<DecisionResponse> => {
    requests.push(request);
    const turn = turns[requests.length - 1];
    if (!turn) throw new Error(`Unexpected request ${requests.length}`);
    if ("throws" in turn) throw turn.throws;
    if ("responds" in turn) return turn.responds as DecisionResponse;
    const answers = "answers" in turn ? turn.answers : turn.answer(request);
    return { model: "typesafe/jev-1.13", answers };
  };
  return { decide, requests };
}

/** Stage one's answers: the operation chosen, and how far the goal is met. */
export const stageOne = (
  operation: string,
  goalMet = 0.1,
  goalRemaining?: number
) => ({
  answers: {
    operation: {
      type: "choice",
      choice: operation,
      probabilities: { [operation]: 0.9 },
    },
    goal_met: { type: "noul", noul: goalMet },
    ...(goalRemaining === undefined
      ? {}
      : { goal_remaining: { type: "noul", noul: goalRemaining } }),
  },
});

/**
 * Stage one's answers when it also asks for Goal Values: the operation, and
 * per speculative question the key `values` names for its id, "no value
 * needed" for the others, so that stage two asks the parameter itself.
 */
export const stageOneWithValues = (
  operation: string,
  values: Record<string, string> = {}
): Turn => ({
  answer: (request) => ({
    ...stageOne(operation).answers,
    ...Object.fromEntries(
      Object.keys(request.questions)
        .filter((id) => id.startsWith("value:"))
        .map((id) => [id, choice(values[id] ?? NO_VALUE_NEEDED_KEY)])
    ),
  }),
});

/** A choice answer for one question, scored 1 on the chosen key. */
export const choice = (key: string) => ({
  type: "choice",
  choice: key,
  probabilities: { [key]: 1 },
});

/** A noul answer: how likely the value asked about belongs. */
export const noul = (score: number) => ({ type: "noul", noul: score });

/**
 * Answer every question of the request: `pick` names the key per question id,
 * `"none"` for "none of these".
 */
export const answering =
  (pick: (id: string) => string) =>
  (request: DecisionRequest): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(request.questions).map((id) => {
        const key = pick(id);
        return [id, choice(key === "none" ? NONE_OF_THESE_KEY : key)];
      })
    );

/** A question as a request carries it. */
export type AskedQuestion = {
  type: string;
  instructions: string;
  criteria?: Record<string, string>;
};

/** The questions of a request, by id. */
export const questionsOf = (request: DecisionRequest | undefined) =>
  (request?.questions ?? {}) as Record<string, AskedQuestion>;

/** The option keys of one question of a request, in the order offered. */
export const criteriaKeys = (
  request: DecisionRequest | undefined,
  id: string
): string[] => Object.keys(questionsOf(request)[id]?.criteria ?? {});

export const step = (
  decide: GoalLoopDecisionFunction,
  input: Partial<StepInput> = {}
): ReturnType<typeof decideStep> => {
  const capture = input.capture ?? captureOfButtons(3);
  return decideStep({
    goal: "do the thing",
    history: [],
    toolOptions: [optionOf(clickTool), optionOf(saveTool)].map((option) =>
      withCapturedNodes(option, capture)
    ),
    pomDefinitions: "",
    decide,
    ...input,
    capture,
    ...(input.toolOptions
      ? {
          toolOptions: input.toolOptions.map((option) =>
            withCapturedNodes(option, capture)
          ),
        }
      : {}),
  });
};

export const ranOk = (
  record: Pick<GoalLoopStepRecord, "operation" | "chosen" | "page_changed">
): GoalLoopStepRecord => ({
  ...record,
  result: "ok",
  did: `${record.operation}(…)`,
});
