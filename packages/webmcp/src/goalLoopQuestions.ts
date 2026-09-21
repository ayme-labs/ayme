import type {
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";
import type { JsonPrimitive, JsonSchema, ToolParameter } from "./contracts";
import type { DecisionQuestions, DecisionRequest } from "./decisionTypes";
import type { AriaRef, PageStateCapture } from "./pageState";
import { listRefTools } from "./refTools";
import {
  listCollectionToolRoots,
  listRegisteredPomTools,
  type RegisteredPomRoot,
} from "./registry";

/**
 * What the Goal Loop asks the model, and how an answer maps back to what it
 * offered. The loop itself owns only the sequence of steps.
 */

const DECISION_MODEL = "typesafe/jev-1.13";

/** The decisions API answers a choice over at most this many options. */
const MAX_CHOICE_OPTIONS = 255;

/** The extra choice of an optional closed-set parameter. */
const LEAVE_UNSET_KEY = "leave_unset";

// --- Operations offered in stage one ---

/** A closed set of values the model may pick one of. */
type ClosedSet =
  | { kind: "ref"; filter: (element: Element) => boolean }
  /** The present roots of one collection path; no filter is involved. */
  | { kind: "instance"; roots: readonly RegisteredPomRoot[] }
  | { kind: "values"; values: readonly JsonPrimitive[] };

/** One parameter of an operation, classified by what the model may fill. */
type ArgumentSpec = {
  /** The question id: the parameter's name, dotted inside a nested object. */
  name: string;
  /** Where the chosen value goes in the operation's input. */
  path: readonly string[];
  optional: boolean;
  /** The parameter's own description, when its schema carries one. */
  description?: string;
  /** null = a value the model cannot pick from a closed set. */
  closedSet: ClosedSet | null;
};

export type ExecutableTool = {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
  /** Parameter names a caller must pass; empty when the tool takes none. */
  requiredParams: string[];
  args: ArgumentSpec[];
};

export type ToolOption = {
  key: string;
  label: string;
  tool: ExecutableTool;
};

/** A ref, an enum value or a boolean: what the model is allowed to fill. */
function closedSetOf(schema: JsonSchema): ClosedSet | null {
  if (schema.enum) return { kind: "values", values: schema.enum };
  if (schema.type === "boolean")
    return { kind: "values", values: [true, false] };
  return null;
}

function specOf(
  parameter: ToolParameter,
  prefix: readonly string[] = []
): ArgumentSpec {
  const path = [...prefix, parameter.name];
  return {
    name: path.join("."),
    path,
    optional: parameter.optional,
    ...(parameter.schema.description
      ? { description: parameter.schema.description }
      : {}),
    closedSet: closedSetOf(parameter.schema),
  };
}

/** Read an object schema as the parameters the loop may fill, under `prefix`. */
function specsOfObjectSchema(
  schema: JsonSchema,
  prefix: readonly string[] = []
): ArgumentSpec[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, propertySchema]) =>
    specOf(
      { name, optional: !required.has(name), schema: propertySchema },
      prefix
    )
  );
}

/** Read a published Ref Tool's input schema the same way. */
function specsOfRefToolSchema(
  schema: JsonSchema,
  refFilter: (element: Element) => boolean
): ArgumentSpec[] {
  return specsOfObjectSchema(schema).map((spec) =>
    // A Ref Tool's `ref` is the Structural Ref it acts on; the elements its
    // filter keeps are the closed set (ADR-0023).
    spec.name === "ref"
      ? { ...spec, closedSet: { kind: "ref", filter: refFilter } }
      : spec
  );
}

/**
 * A tool that goes through a collection takes `{ ref, args }` (#82): the ref
 * addresses one present instance of its path, the action's own parameters sit
 * inside `args` and are classified like any other parameter.
 */
function specsOfCollectionTool(
  parameters: readonly ToolParameter[],
  roots: readonly RegisteredPomRoot[]
): ArgumentSpec[] {
  return parameters.flatMap((parameter) =>
    parameter.name === "ref"
      ? [
          {
            name: "ref",
            path: ["ref"],
            optional: parameter.optional,
            closedSet: { kind: "instance", roots } as const,
          },
        ]
      : specsOfObjectSchema(parameter.schema, [parameter.name])
  );
}

/**
 * Build the flat list of tool options offered to the model each step: every
 * Ref Tool, built in or registered (ADR-0023), and every registered POM tool.
 */
export function buildToolOptions(): ToolOption[] {
  const refTools: ExecutableTool[] = listRefTools().map(({ tool, filter }) => ({
    name: tool.name,
    description: tool.description,
    execute: (input: unknown) => tool.execute(input),
    requiredParams: [...(tool.inputSchema.required ?? [])],
    args: specsOfRefToolSchema(tool.inputSchema, filter),
  }));
  const collectionRoots = listCollectionToolRoots();
  const pomTools: ExecutableTool[] = listRegisteredPomTools().map((t) => {
    const roots = collectionRoots.get(t.name);
    const args = roots
      ? specsOfCollectionTool(t.parameters, roots)
      : t.parameters.map((parameter) => specOf(parameter));
    return {
      name: t.name,
      description: t.description,
      // An action without parameters of its own still takes the empty `args`.
      execute: (input: unknown) =>
        t.execute(
          roots ? { args: {}, ...(input as Record<string, unknown>) } : input
        ),
      requiredParams: args
        .filter((arg) => !arg.optional)
        .map((arg) => arg.name),
      args,
    };
  });

  return [...refTools, ...pomTools].map((tool) => ({
    key: tool.name,
    label: tool.description,
    tool,
  }));
}

// --- Arguments asked in stage two ---

export type ArgumentOption = {
  key: string;
  description: string;
  /**
   * The argument this option stands for; absent means "leave unset". A ref
   * option carries the branded Structural Ref of the capture it was built
   * from, so an answer never becomes a ref string parsed from model output.
   */
  value?: AriaRef | JsonPrimitive;
};

export type ArgumentQuestion = {
  /** The question id: the parameter's name, dotted inside a nested object. */
  parameter: string;
  /** Where the chosen value goes in the operation's input. */
  path: readonly string[];
  instructions: string;
  options: ArgumentOption[];
};

/** What the loop does with the chosen operation once its schema is read. */
export type ArgumentPlan =
  /** Run it, after the model answered these questions (none = run it now). */
  | { kind: "ask"; questions: ArgumentQuestion[] }
  /** A required value outside the closed sets: the calling agent supplies it. */
  | { kind: "needs_free_value"; parameters: string[] }
  /** The elements to offer for a ref do not make a choice the model can answer. */
  | { kind: "needs_ref_choice"; parameter: string; optionCount: number };

/** Every node of the capture that has an element the filter keeps. */
function refOptions(
  filter: (element: Element) => boolean,
  capture: PageStateCapture
): ArgumentOption[] {
  const options: ArgumentOption[] = [];
  for (const node of walkNodes(capture.tree)) {
    // Synthetic refs are observation-only: a Ref Tool rejects them.
    if (node.ref.startsWith("s_")) continue;
    const element = capture.elementsByRef.get(node.ref);
    if (!element || !filter(element)) continue;
    options.push({
      key: node.ref,
      description: describeNode(node),
      value: node.ref,
    });
  }
  return options;
}

/** Enough of the node for the model to tell the options apart. */
function describeNode(node: StructuralNode): string {
  return node.name ? `${node.role} "${node.name}"` : node.role;
}

/**
 * One option per present root of a collection path, keyed by the ref the same
 * capture gave that root's element. A root the capture holds no ref for cannot
 * be targeted and is left out.
 */
function instanceOptions(
  roots: readonly RegisteredPomRoot[],
  capture: PageStateCapture
): ArgumentOption[] {
  const refsByElement = new Map<Element, AriaRef>();
  for (const [ref, element] of capture.elementsByRef)
    refsByElement.set(element, ref);

  return roots.flatMap((root) => {
    const ref = refsByElement.get(root.element);
    const node = ref === undefined ? null : capture.tree.getNode(ref);
    if (ref === undefined || node === null) return [];
    return [
      {
        key: ref,
        description: `${root.label} (${describeNode(node)})`,
        value: ref,
      },
    ];
  });
}

function* walkNodes(tree: StructuralTree): Generator<StructuralNode> {
  const pending = [...tree.getRootNodes()].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    yield node;
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!;
      if (typeof child !== "string") pending.push(child);
    }
  }
}

function valueOptions(values: readonly JsonPrimitive[]): ArgumentOption[] {
  return values.map((value) => ({
    key: String(value),
    description: String(value),
    value,
  }));
}

function argumentInstructions(tool: ExecutableTool, arg: ArgumentSpec): string {
  const parameter = arg.description
    ? `"${arg.name}" (${arg.description})`
    : `"${arg.name}"`;
  const operation = `The operation is "${tool.name}": ${tool.description}`;
  switch (arg.closedSet?.kind) {
    case "ref":
      return `Pick the element this operation acts on as its ${parameter} parameter. ${operation}`;
    case "instance":
      return `Pick the instance this operation acts on as its ${parameter} parameter. ${operation}`;
    default:
      return `Pick the value for the ${parameter} parameter of this operation. ${operation}`;
  }
}

/**
 * Decide what the chosen operation still needs: questions the model can
 * answer from closed sets, or a value only the calling agent can supply.
 */
export function planArguments(
  tool: ExecutableTool,
  capture: PageStateCapture
): ArgumentPlan {
  if (tool.args.some((arg) => !arg.optional && arg.closedSet === null))
    return { kind: "needs_free_value", parameters: tool.requiredParams };

  const questions: ArgumentQuestion[] = [];
  for (const arg of tool.args) {
    const closedSet = arg.closedSet;
    // An optional parameter outside the closed sets is left out.
    if (!closedSet) continue;

    const options =
      closedSet.kind === "ref"
        ? refOptions(closedSet.filter, capture)
        : closedSet.kind === "instance"
          ? instanceOptions(closedSet.roots, capture)
          : valueOptions(closedSet.values);
    if (
      closedSet.kind !== "values" &&
      (options.length === 0 || options.length > MAX_CHOICE_OPTIONS)
    )
      return {
        kind: "needs_ref_choice",
        parameter: arg.name,
        optionCount: options.length,
      };

    if (arg.optional)
      options.push({
        key: LEAVE_UNSET_KEY,
        description: `Leave "${arg.name}" unset; the operation uses its default.`,
      });
    questions.push({
      parameter: arg.name,
      path: arg.path,
      instructions: argumentInstructions(tool, arg),
      options,
    });
  }
  return { kind: "ask", questions };
}

// --- Decision requests (ADR-0022: built in the browser) ---

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

export type StepState = Record<string, unknown>;

/** The state both stages of one step are decided on. */
export function buildStepState(
  goal: string,
  pageTree: StructuralTree,
  pomDefinitionsText: string,
  history: readonly unknown[]
): StepState {
  return {
    goal,
    page: serializeTree(pageTree),
    page_objects: pomDefinitionsText,
    history,
  };
}

/** Stage one: which operation moves closest to the goal, and is it met. */
export function buildOperationRequest(
  state: StepState,
  toolOptions: readonly ToolOption[]
): DecisionRequest {
  const criteria: Record<string, string> = {};
  for (const option of toolOptions) criteria[option.key] = option.label;
  criteria["none"] = "No available operation fits the goal right now.";

  const questions: DecisionQuestions = {
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

/** Stage two: the chosen operation's arguments, asked in parallel. */
export function buildArgumentRequest(
  state: StepState,
  argumentQuestions: readonly ArgumentQuestion[]
): DecisionRequest {
  const questions: DecisionQuestions = {};
  for (const question of argumentQuestions) {
    const criteria: Record<string, string> = {};
    for (const option of question.options)
      criteria[option.key] = option.description;
    questions[question.parameter] = {
      type: "choice",
      instructions: question.instructions,
      criteria,
    };
  }
  return { model: DECISION_MODEL, state, questions };
}

// --- Answers ---

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export type NoulAnswer = {
  type: "noul";
  noul: number;
};

function readChoiceAnswer(
  answers: Record<string, unknown>,
  id: string
): ChoiceAnswer {
  const raw = answers[id];
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as Record<string, unknown>).type !== "choice" ||
    typeof (raw as Record<string, unknown>).choice !== "string"
  )
    throw new Error(`Invalid ${id} answer from decision function.`);
  return raw as ChoiceAnswer;
}

/** Extract and validate the `operation` choice answer from the model response. */
export function parseOperationAnswer(
  answers: Record<string, unknown>
): ChoiceAnswer {
  return readChoiceAnswer(answers, "operation");
}

/** Extract and validate the `goal_met` noul answer from the model response. */
export function parseGoalMetAnswer(
  answers: Record<string, unknown>
): NoulAnswer {
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

export type ChosenArguments = {
  /** The arguments to call the operation with; a ref is the offered branded ref. */
  args: Record<string, unknown>;
  /** What was chosen, in readable words, for the history entry. */
  summary: string[];
  probabilities: Record<string, Record<string, number>>;
};

/**
 * Map each answer back to one of the options that question offered. Model
 * output is never read as a value of its own; an answer outside the offered
 * options is an invalid response.
 */
export function readArgumentAnswers(
  argumentQuestions: readonly ArgumentQuestion[],
  answers: Record<string, unknown>
): ChosenArguments {
  const args: Record<string, unknown> = {};
  const summary: string[] = [];
  const probabilities: Record<string, Record<string, number>> = {};

  for (const question of argumentQuestions) {
    const answer = readChoiceAnswer(answers, question.parameter);
    const chosen = question.options.find(
      (option) => option.key === answer.choice
    );
    if (!chosen)
      throw new Error(
        `The model chose "${answer.choice}" for "${question.parameter}", which is not one of the offered options.`
      );
    if (answer.probabilities)
      probabilities[question.parameter] = answer.probabilities;
    if (!("value" in chosen)) continue;
    assignAt(args, question.path, chosen.value);
    summary.push(`${question.parameter}: ${chosen.description}`);
  }

  return { args, summary, probabilities };
}

/** Put a chosen value where the operation's input expects it. */
function assignAt(
  args: Record<string, unknown>,
  path: readonly string[],
  value: unknown
): void {
  let target = args;
  for (const key of path.slice(0, -1))
    target = (target[key] ??= {}) as Record<string, unknown>;
  target[path[path.length - 1]!] = value;
}
