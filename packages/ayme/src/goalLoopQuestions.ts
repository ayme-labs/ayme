import {
  projectStructuralNodeForest,
  renderJsonStructuralNodeForest,
  renderTree,
  structuralNodeForest,
  type JsonStructuralNodeForest,
  type ProjectedStructuralNodeForest,
  type StructuralNode,
  type StructuralNodeForest,
  type StructuralTree,
  type TreeRendering,
} from "@ayme-dev/core/structural-observation";
import type { JsonPrimitive, JsonSchema, ToolParameter } from "./contracts";
import type { DecisionQuestions, DecisionRequest } from "./decisionTypes";
import type { GoalLoopStepRecord } from "./goalLoop";
import type { AriaRef, PageStateCapture } from "./pageState";
import { listElementTools, NAVIGATION_TOOLS } from "./browserTools";
import type { ChildRun } from "./run";
import { acceptedRefNodes, type TargetField } from "./elementTools";
import {
  listCollectionToolRoots,
  listCallerAwarePomTools,
  type RegisteredPomRoot,
} from "./registry";

/**
 * What the Goal Loop asks the model, and how an answer maps back to what it
 * offered. The loop itself owns only the sequence of steps.
 */

/** The decisions API answers a choice over at most this many options. Every
 *  question is kept within it, counted as it is sent. */
const MAX_CHOICE_OPTIONS = 255;

/** The extra choice of an optional closed-set parameter. */
const LEAVE_UNSET_KEY = "leave_unset";

/**
 * The extra choice of every chunk of a ref question whose elements outnumber
 * the cap: the chunks are asked side by side, so all but one usually hold no
 * fitting element. Under the cap a ref question has no such choice.
 */
export const NONE_OF_THESE_KEY = "none_of_these";

/** A chunk holds at most this many elements, leaving room for "none of these". */
const MAX_CHUNK_ELEMENTS = MAX_CHOICE_OPTIONS - 1;

/**
 * At most this many Goal Values, so that a question offering every one plus
 * "none of these" or "leave unset" stays within the cap.
 */
export const MAX_GOAL_VALUES = MAX_CHOICE_OPTIONS - 1;

// --- Question ids ---
//
// A question is normally identified by its parameter's name. A ref parameter
// over the cap is asked as several questions, so those carry ids of their own:
// the parameter's name, a separator, then the chunk's ordinal or "run_off". A
// list parameter filled from Goal Values asks one question per value, with the
// value's ordinal; a ref is never a list, so the two never meet.
// The separator is lengthened until no parameter name of the operation starts
// with the parameter's name and it, so these ids never equal a parameter name.
// An answer is mapped back through `ArgumentQuestion.parameter`, never by
// reading its id.

/** What every chunk and run-off id of `parameter` starts with. */
function derivedIdPrefix(
  parameter: string,
  parameterNames: readonly string[]
): string {
  let prefix = `${parameter}_`;
  while (parameterNames.some((name) => name.startsWith(prefix))) prefix += "_";
  return prefix;
}

/**
 * The id of the `ordinal`-th chunk (1-based) of a parameter's options, given
 * the names of every parameter of the operation.
 */
export function chunkQuestionId(
  parameter: string,
  ordinal: number,
  parameterNames: readonly string[]
): string {
  return `${derivedIdPrefix(parameter, parameterNames)}${ordinal}`;
}

/**
 * The id of the run-off among the elements a parameter's chunks named, given
 * the names of every parameter of the operation.
 */
export function runOffQuestionId(
  parameter: string,
  parameterNames: readonly string[]
): string {
  return `${derivedIdPrefix(parameter, parameterNames)}run_off`;
}

/**
 * The id of the question whether the `ordinal`-th Goal Value (1-based) that
 * fits a list parameter belongs in it, given the names of every parameter of
 * the operation.
 */
export function listValueQuestionId(
  parameter: string,
  ordinal: number,
  parameterNames: readonly string[]
): string {
  return `${derivedIdPrefix(parameter, parameterNames)}${ordinal}`;
}

const parameterNamesOf = (tool: ExecutableTool) =>
  tool.args.map((arg) => arg.name);

// --- Operations offered in stage one ---

/** A closed set of values the model may pick one of. */
type ClosedSet =
  | { kind: "ref"; filter: (element: Element) => boolean }
  /** The present roots of one collection path; no filter is involved. */
  | { kind: "instance"; roots: readonly RegisteredPomRoot[] }
  | { kind: "values"; values: readonly JsonPrimitive[] };

/**
 * Goal Values: labelled strings or numbers the calling agent passes with a
 * goal, for the model to pick from where the page offers nothing to pick.
 */
export type GoalValues = Readonly<Record<string, string | number>>;

/** The Goal Values a parameter outside the closed sets can take. */
type FreeKind = "string" | "number" | "integer" | "string_list";

/** One parameter of an operation, classified by what the model may fill. */
type ArgumentSpec = {
  /** The parameter's name, dotted inside a nested object. */
  name: string;
  /** Where the chosen value goes in the operation's input. */
  path: readonly string[];
  optional: boolean;
  /** The parameter's own description, when its schema carries one. */
  description?: string;
  /** null = a value the model cannot pick from a closed set. */
  closedSet: ClosedSet | null;
  /**
   * Outside the closed sets: the Goal Values that fit the parameter. Absent
   * when none ever can, such as for an object.
   */
  free?: FreeKind;
};

export type ExecutableTool = {
  name: string;
  description: string;
  /**
   * Runs the tool as a step, a child Run of the goal Run through `run`: the
   * Goal Loop's model reads its page.
   */
  execute(input: unknown, run: ChildRun): Promise<unknown>;
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

function freeKindOf(schema: JsonSchema): FreeKind | undefined {
  switch (schema.type) {
    case "string":
    case "number":
    case "integer":
      return schema.type;
    case "array":
      return schema.items?.type === "string" ? "string_list" : undefined;
    default:
      return undefined;
  }
}

function specOf(
  parameter: ToolParameter,
  prefix: readonly string[] = [],
  closedSet = closedSetOf(parameter.schema)
): ArgumentSpec {
  const path = [...prefix, parameter.name];
  const free = closedSet ? undefined : freeKindOf(parameter.schema);
  return {
    name: path.join("."),
    path,
    optional: parameter.optional,
    ...(parameter.schema.description
      ? { description: parameter.schema.description }
      : {}),
    closedSet,
    ...(free ? { free } : {}),
  };
}

/** The parameters of an object schema, each a `ToolParameter`. */
function parametersOfObjectSchema(schema: JsonSchema): ToolParameter[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(
    ([name, propertySchema]) => ({
      name,
      optional: !required.has(name),
      schema: propertySchema,
    })
  );
}

/** Read an object schema as the parameters the loop may fill, under `prefix`. */
function specsOfObjectSchema(
  schema: JsonSchema,
  prefix: readonly string[] = []
): ArgumentSpec[] {
  return parametersOfObjectSchema(schema).map((parameter) =>
    specOf(parameter, prefix)
  );
}

/** Read a single-element tool's input schema the same way. */
function specsOfElementToolSchema(
  schema: JsonSchema,
  targetField: TargetField,
  refFilter: (element: Element) => boolean
): ArgumentSpec[] {
  return parametersOfObjectSchema(schema).map((parameter) =>
    // Its `ref` or `target` is the Structural Ref it acts on; the elements its
    // filter keeps are the closed set (ADR-0023).
    parameter.name === targetField
      ? specOf(parameter, [], { kind: "ref", filter: refFilter })
      : specOf(parameter)
  );
}

/**
 * A tool that goes through a collection takes `{ ref, args }`: the ref
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
 * single-element tool, a Browser Tool or a Custom Tool (ADR-0023), every
 * Browser Tool that moves the page, and every registered POM tool.
 */
export function buildToolOptions(): ToolOption[] {
  const elementTools: ExecutableTool[] = listElementTools().map(
    ({ tool, targetField, loopInputSchema, filter }) => ({
      name: tool.name,
      description: tool.description,
      execute: (input: unknown, run: ChildRun) =>
        run(tool.name, input, "goalLoop"),
      requiredParams: [...(loopInputSchema.required ?? [])],
      args: specsOfElementToolSchema(loopInputSchema, targetField, filter),
    })
  );
  const navigationTools: ExecutableTool[] = NAVIGATION_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    execute: (input: unknown, run: ChildRun) =>
      run(tool.name, input, "goalLoop"),
    requiredParams: [...(tool.inputSchema.required ?? [])],
    args: specsOfObjectSchema(tool.inputSchema),
  }));
  const collectionRoots = listCollectionToolRoots();
  const pomTools: ExecutableTool[] = listCallerAwarePomTools().map((t) => {
    const roots = collectionRoots.get(t.name);
    const args = roots
      ? specsOfCollectionTool(t.parameters, roots)
      : t.parameters.map((parameter) => specOf(parameter));
    return {
      name: t.name,
      description: t.description,
      // An action without parameters of its own still takes the empty `args`.
      execute: (input: unknown, run: ChildRun) =>
        run(
          t.name,
          roots ? { args: {}, ...(input as Record<string, unknown>) } : input,
          "goalLoop"
        ),
      requiredParams: args
        .filter((arg) => !arg.optional)
        .map((arg) => arg.name),
      args,
    };
  });

  return [...elementTools, ...navigationTools, ...pomTools].map((tool) => ({
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
   * The argument this option stands for; absent means the option names no
   * argument ("leave unset", "none of these"). A ref option carries the
   * branded Structural Ref of the capture it was built from, so an answer
   * never becomes a ref string parsed from model output.
   */
  value?: AriaRef | JsonPrimitive;
};

type QuestionBase = {
  /**
   * The question id in the request. It is the parameter's name, except for a
   * ref parameter whose elements outnumber the cap: each chunk of its options
   * is one question (`chunkQuestionId`), and a run-off among the chunks'
   * answers is another (`runOffQuestionId`); and for a list parameter, whose
   * every Goal Value is one question (`listValueQuestionId`). None equals a
   * parameter name.
   */
  id: string;
  /** The parameter the answer fills: its name, dotted inside a nested object. */
  parameter: string;
  /** Where the chosen value goes in the operation's input. */
  path: readonly string[];
  instructions: string;
};

/** One option to choose for a parameter, or for a chunk or run-off of a ref. */
export type ArgumentQuestion = QuestionBase & {
  type: "choice";
  options: ArgumentOption[];
};

/** Whether one Goal Value belongs in a list parameter. */
export type ListValueQuestion = QuestionBase & {
  type: "noul";
  option: ArgumentOption;
};

export type StageTwoQuestion = ArgumentQuestion | ListValueQuestion;

/** What the loop does with the chosen operation once its schema is read. */
export type ArgumentPlan =
  /** Run it, after the model answered these questions (none = run it now). */
  | { kind: "ask"; questions: StageTwoQuestion[] }
  /**
   * A required value outside the closed sets that no Goal Value fits: the
   * calling agent supplies it.
   */
  | {
      kind: "needs_free_value";
      /** Every required parameter, for a direct call. */
      parameters: string[];
      /** The required parameters no Goal Value fits. */
      unfilled: string[];
    }
  /** No element on the page is one the operation's ref may address. */
  | { kind: "needs_ref_choice"; parameter: string }
  /** The instances of a collection do not make a choice the model can answer. */
  | { kind: "needs_instance_choice"; parameter: string; optionCount: number }
  /** The values of a closed set do not make a choice the model can answer. */
  | { kind: "needs_value_choice"; parameter: string; optionCount: number };

/** Every node of the capture a single-element tool with this filter can take. */
function refOptions(
  filter: (element: Element) => boolean,
  capture: PageStateCapture
): ArgumentOption[] {
  return acceptedRefNodes(filter, capture).map((node) => ({
    key: node.ref,
    description: describeNode(node),
    value: node.ref,
  }));
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

function valueOptions(values: readonly JsonPrimitive[]): ArgumentOption[] {
  return values.map((value) => ({
    key: String(value),
    description: String(value),
    value,
  }));
}

function fits(kind: FreeKind, value: string | number): boolean {
  switch (kind) {
    case "string":
    case "string_list":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
  }
}

/**
 * One option per Goal Value that fits the parameter, in the order of the
 * values map, keyed by its label. The model reads `label: value`.
 */
function goalValueOptions(
  kind: FreeKind | undefined,
  values: GoalValues
): ArgumentOption[] {
  if (!kind) return [];
  return Object.entries(values)
    .filter(([, value]) => fits(kind, value))
    .map(([label, value]) => ({
      key: label,
      description: `${label}: ${value}`,
      value,
    }));
}

/**
 * An answer is matched back by key, so two options of one question must not
 * share one. Keys are read by the model, so a value keeps its own text and
 * only a key already taken within the question is made unique.
 */
function withUniqueKeys(options: ArgumentOption[]): ArgumentOption[] {
  const taken = new Set<string>();
  return options.map((option) => {
    let key = option.key;
    for (let attempt = 2; taken.has(key); attempt++)
      key = `${option.key} (${attempt})`;
    taken.add(key);
    return key === option.key ? option : { ...option, key };
  });
}

function describeParameter(arg: Pick<ArgumentSpec, "name" | "description">) {
  return arg.description
    ? `"${arg.name}" (${arg.description})`
    : `"${arg.name}"`;
}

function describeOperation(tool: ExecutableTool): string {
  return `The operation is "${tool.name}": ${tool.description}`;
}

/** The sentence every question about a ref parameter starts with. */
function pickElementSentence(parameter: string): string {
  return `Pick the element this operation acts on as its ${parameter} parameter.`;
}

function argumentInstructions(tool: ExecutableTool, arg: ArgumentSpec): string {
  const parameter = describeParameter(arg);
  const operation = describeOperation(tool);
  switch (arg.closedSet?.kind) {
    case "ref":
      return `${pickElementSentence(parameter)} ${operation}`;
    case "instance":
      return `Pick the instance this operation acts on as its ${parameter} parameter. ${operation}`;
    case undefined:
      return `Pick the Goal Value to use as the ${parameter} parameter of this operation. ${operation}`;
    default:
      return `Pick the value for the ${parameter} parameter of this operation. ${operation}`;
  }
}

/**
 * Cut a ref parameter's options into contiguous chunks in document order, each
 * a question of its own. The chunks are as even as the count allows and every
 * one stays within the cap with its "none of these". Nothing is merged, ranked
 * or reordered: the model is offered what the page shows, one option per
 * element.
 */
function chunkedRefQuestions(
  tool: ExecutableTool,
  arg: ArgumentSpec,
  options: readonly ArgumentOption[]
): ArgumentQuestion[] {
  const count = Math.ceil(options.length / MAX_CHUNK_ELEMENTS);
  const size = Math.ceil(options.length / count);
  const parameter = describeParameter(arg);
  return Array.from({ length: count }, (_, index) => {
    const from = index * size;
    const chunk = options.slice(from, from + size);
    return {
      type: "choice" as const,
      id: chunkQuestionId(arg.name, index + 1, parameterNamesOf(tool)),
      parameter: arg.name,
      path: arg.path,
      instructions:
        `${pickElementSentence(parameter)} ` +
        `The page holds ${options.length} candidate elements, split in document order over ${count} questions; ` +
        `this one offers elements ${from + 1} to ${from + chunk.length}. ` +
        `Choose "${NONE_OF_THESE_KEY}" when the element is not among these. ` +
        describeOperation(tool),
      options: [
        ...chunk,
        {
          key: NONE_OF_THESE_KEY,
          description: `None of these; the element is offered by another "${arg.name}" question, or no element fits.`,
        },
      ],
    };
  });
}

/**
 * When several chunks each named an element, one more question offers exactly
 * those elements, and nothing else, so the model picks between them directly.
 */
function runOffQuestion(
  tool: ExecutableTool,
  chunk: ArgumentQuestion,
  named: readonly ArgumentOption[]
): ArgumentQuestion {
  return {
    type: "choice",
    id: runOffQuestionId(chunk.parameter, parameterNamesOf(tool)),
    parameter: chunk.parameter,
    path: chunk.path,
    instructions:
      `Several "${chunk.parameter}" questions each named an element. ` +
      `Pick the one element this operation acts on as its "${chunk.parameter}" parameter. ` +
      describeOperation(tool),
    options: [...named],
  };
}

/** The extra option of an optional parameter: leave it unset. */
const leaveUnsetOption = (arg: ArgumentSpec): ArgumentOption => ({
  key: LEAVE_UNSET_KEY,
  description: `Leave "${arg.name}" unset; the operation uses its default.`,
});

/**
 * One question per Goal Value that fits a list parameter, asked side by side:
 * does this value belong in the list?
 */
function listValueQuestions(
  tool: ExecutableTool,
  arg: ArgumentSpec,
  options: readonly ArgumentOption[]
): ListValueQuestion[] {
  return options.map((option, index) => ({
    type: "noul",
    id: listValueQuestionId(arg.name, index + 1, parameterNamesOf(tool)),
    parameter: arg.name,
    path: arg.path,
    instructions:
      `Does the Goal Value "${option.description}" belong in the list ${describeParameter(arg)} of this operation? ` +
      describeOperation(tool),
    option,
  }));
}

/**
 * Decide what the chosen operation still needs: questions the model can
 * answer from closed sets and Goal Values, or a value only the calling agent
 * can supply.
 */
export function planArguments(
  tool: ExecutableTool,
  capture: PageStateCapture,
  values: GoalValues = {}
): ArgumentPlan {
  const unfilled = tool.args
    .filter(
      (arg) =>
        !arg.optional &&
        arg.closedSet === null &&
        goalValueOptions(arg.free, values).length === 0
    )
    .map((arg) => arg.name);
  if (unfilled.length > 0)
    return {
      kind: "needs_free_value",
      parameters: tool.requiredParams,
      unfilled,
    };

  const questions: StageTwoQuestion[] = [];
  for (const arg of tool.args) {
    const closedSet = arg.closedSet;
    if (!closedSet) {
      const candidates = goalValueOptions(arg.free, values);
      // An optional parameter no Goal Value fits is left out.
      if (candidates.length === 0) continue;
      if (arg.free === "string_list") {
        questions.push(...listValueQuestions(tool, arg, candidates));
        continue;
      }
      // MAX_GOAL_VALUES leaves room for the extra option within the cap.
      questions.push({
        type: "choice",
        id: arg.name,
        parameter: arg.name,
        path: arg.path,
        instructions: argumentInstructions(tool, arg),
        options: withUniqueKeys([
          ...candidates,
          arg.optional
            ? leaveUnsetOption(arg)
            : {
                key: NONE_OF_THESE_KEY,
                description: `None of these Goal Values fits "${arg.name}".`,
              },
        ]),
      });
      continue;
    }

    const options = withUniqueKeys([
      ...(closedSet.kind === "ref"
        ? refOptions(closedSet.filter, capture)
        : closedSet.kind === "instance"
          ? instanceOptions(closedSet.roots, capture)
          : valueOptions(closedSet.values)),
      ...(arg.optional ? [leaveUnsetOption(arg)] : []),
    ]);

    // A ref whose elements outnumber the cap is asked in chunks; other closed
    // sets are not.
    if (closedSet.kind === "ref" && options.length > MAX_CHOICE_OPTIONS) {
      questions.push(...chunkedRefQuestions(tool, arg, options));
      continue;
    }

    // A question outside the limit is never sent. An optional parameter the
    // loop cannot ask about is left unset, like the choice it would have had.
    if (options.length === 0 || options.length > MAX_CHOICE_OPTIONS) {
      if (arg.optional) continue;
      // A ref gets here only with no element left to offer.
      if (closedSet.kind === "ref")
        return { kind: "needs_ref_choice", parameter: arg.name };
      return {
        kind:
          closedSet.kind === "values"
            ? "needs_value_choice"
            : "needs_instance_choice",
        parameter: arg.name,
        optionCount: options.length,
      };
    }

    questions.push({
      type: "choice",
      id: arg.name,
      parameter: arg.name,
      path: arg.path,
      instructions: argumentInstructions(tool, arg),
      options,
    });
  }
  return { kind: "ask", questions };
}

// --- Decision requests (ADR-0022: built in the browser) ---

/**
 * A node the model is not shown: a `generic` with no name, props, state or
 * pointer cursor, whatever its children. Nothing targetable is among them: a
 * ref-only wrapper is never an option, and a single-character text leaf is
 * not interactive. Exploding them hoists their children, so a chain of
 * wrappers vanishes and the text of a leaf is hoisted as the string it is.
 */
function prunable(node: StructuralNode): boolean {
  return (
    node.role === "generic" &&
    node.name === "" &&
    Object.keys(node.props).length === 0 &&
    !Object.values(node.state).some((value) => value !== undefined) &&
    !node.cursorPointer
  );
}

/**
 * The stages the model is shown the page through: projected as it is and
 * rendered as JSON. The rendered page travels inside the decision request.
 */
const pageRendering: TreeRendering<
  StructuralNodeForest<StructuralNode>,
  ProjectedStructuralNodeForest,
  JsonStructuralNodeForest
> = {
  projection: (forest) => projectStructuralNodeForest(forest),
  renderer: renderJsonStructuralNodeForest,
};

/**
 * The page as the model is shown it: the full capture's root nodes with the
 * prunable nodes exploded, then `pageRendering`. This forest is derived for
 * serialization only; the ref options and the Change Record keep walking the
 * full capture, so the refs the model reads are the capture's.
 * (`pageState.ts` and `changeRecord.ts` compose the stages by hand.)
 */
function renderPage(pageTree: StructuralTree): JsonStructuralNodeForest {
  const shown = structuralNodeForest(pageTree.getRootNodes()).explode(
    (_entry, node) => prunable(node)
  );
  return renderTree(pageRendering, shown);
}

export type StepState = Record<string, unknown>;

/** The option the model chose for one parameter, exactly as it was offered. */
export type ChosenOption = { key: string; description: string };

/**
 * The state both stages of one step are decided on. It carries the Goal
 * Values as passed, when the calling agent passed them.
 */
export function buildStepState(
  goal: string,
  values: GoalValues | undefined,
  pageTree: StructuralTree,
  pomDefinitionsText: string,
  history: readonly GoalLoopStepRecord[]
): StepState {
  return {
    goal,
    ...(values ? { values } : {}),
    page: renderPage(pageTree),
    page_objects: pomDefinitionsText,
    history,
  };
}

/**
 * The operation question offers every tool plus "none", so it too stays
 * within what one decision can answer.
 */
export function operationQuestionFits(
  toolOptions: readonly ToolOption[]
): boolean {
  return toolOptions.length + 1 <= MAX_CHOICE_OPTIONS;
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

  return { state, questions };
}

/**
 * Stage two: the chosen operation's arguments, asked in parallel. The chunks of
 * a ref over the cap and the Goal Values of a list are questions like any
 * other, so they travel in the same request with the page state sent once. A
 * run-off is the same request shape with its one question.
 */
export function buildArgumentRequest(
  state: StepState,
  argumentQuestions: readonly StageTwoQuestion[]
): DecisionRequest {
  // Built from entries, never by assignment: a key is a Goal Value's label,
  // which may be any string, `__proto__` included.
  const questions: DecisionQuestions = Object.fromEntries(
    argumentQuestions.map((question) => [
      question.id,
      question.type === "noul"
        ? { type: "noul", instructions: question.instructions }
        : {
            type: "choice",
            instructions: question.instructions,
            criteria: Object.fromEntries(
              question.options.map((option) => [option.key, option.description])
            ),
          },
    ])
  );
  return { state, questions };
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

function readNoulAnswer(
  answers: Record<string, unknown>,
  id: string
): NoulAnswer {
  const raw = answers[id];
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as Record<string, unknown>).type !== "noul" ||
    !Number.isFinite((raw as Record<string, unknown>).noul)
  )
    throw new Error(`Invalid ${id} answer from decision function.`);
  return raw as NoulAnswer;
}

/** Extract and validate the `goal_met` noul answer from the model response. */
export function parseGoalMetAnswer(
  answers: Record<string, unknown>
): NoulAnswer {
  return readNoulAnswer(answers, "goal_met");
}

export type ChosenArguments = {
  /** The arguments to call the operation with; a ref is the offered branded ref. */
  args: Record<string, unknown>;
  /**
   * Per parameter asked: the option chosen, as offered, for the step record.
   * A choice that leaves the parameter unset is here, but not in `args`.
   */
  chosen: Record<string, ChosenOption>;
  /** Per question id: the key of the option the model chose. */
  choices: Record<string, string>;
  /**
   * Per question id: the scores, when the decision function supplied them. A
   * list question's score is under the key of the Goal Value it asked about.
   */
  probabilities: Record<string, Record<string, number>>;
  /**
   * Per list parameter: the Goal Values it holds, in the order of the values
   * map, each with the score it was included with.
   */
  lists: Record<string, ListValuePick[]>;
};

/** A Goal Value the model included in a list, and its score. */
type ListValuePick = { question: ListValueQuestion; score: number };

/** What was answered, per question id, whether or not an action follows. */
export type AnswerRecord = Pick<ChosenArguments, "choices" | "probabilities">;

/** What the stage-two answers amount to. */
export type ArgumentAnswers =
  /** Every parameter has its value: run the operation. */
  | { kind: "chosen"; chosen: ChosenArguments }
  /**
   * Several chunks of one parameter each named an element. `chosen` holds the
   * other parameters; `question` is the run-off to ask before running.
   */
  | { kind: "run_off"; chosen: ChosenArguments; question: ArgumentQuestion }
  /** Every chunk of one parameter answered "none of these". */
  | ({ kind: "none_fits"; parameter: string } & AnswerRecord)
  /** No Goal Value fits a required parameter, by the model's answer. */
  | ({ kind: "needs_value"; parameter: string } & AnswerRecord);

/**
 * The option the model picked for one question. Model output is never read as
 * a value of its own; an answer outside the offered options is an invalid
 * response. The chosen key, and the answer's scores when it has them, are
 * recorded under the question id.
 */
function readPick(
  question: ArgumentQuestion,
  answers: Record<string, unknown>,
  record: AnswerRecord
): ArgumentOption {
  const answer = readChoiceAnswer(answers, question.id);
  const chosen = question.options.find(
    (option) => option.key === answer.choice
  );
  if (!chosen)
    throw new Error(
      `The model chose "${answer.choice}" for "${question.id}", which is not one of the offered options.`
    );
  record.choices[question.id] = chosen.key;
  if (answer.probabilities)
    record.probabilities[question.id] = answer.probabilities;
  return chosen;
}

/**
 * Read whether a Goal Value belongs in its list. The score is recorded under
 * the question id, keyed by the value's label.
 */
function readListValue(
  question: ListValueQuestion,
  answers: Record<string, unknown>,
  record: AnswerRecord
): number {
  const { noul } = readNoulAnswer(answers, question.id);
  record.probabilities[question.id] = { [question.option.key]: noul };
  return noul;
}

/**
 * Fill a list parameter with the Goal Values included, in order. Its chosen
 * option joins theirs, as offered.
 */
function chooseList(
  into: ChosenArguments,
  parameter: string,
  picks: readonly ListValuePick[]
): void {
  const options = picks.map((pick) => pick.question.option);
  assignAt(
    into.args,
    picks[0]!.question.path,
    options.map((option) => option.value)
  );
  into.chosen[parameter] = {
    key: options.map((option) => option.key).join(", "),
    description: options.map((option) => option.description).join(", "),
  };
  into.lists[parameter] = [...picks];
}

/** Record the option chosen for a parameter; one without a value leaves it unset. */
function choose(
  into: ChosenArguments,
  question: ArgumentQuestion,
  option: ArgumentOption
): void {
  if ("value" in option) assignAt(into.args, question.path, option.value);
  into.chosen[question.parameter] = {
    key: option.key,
    description: option.description,
  };
}

/**
 * Map each answer back to one of the options that question offered. The
 * chunks of one parameter answer together: the one chunk that named an
 * element decides, several call for a run-off, none means no element fits.
 * The Goal Values of a list answer together too: every one scored at least
 * 0.5 is included. A required parameter left without a value, by "none of
 * these" or by an empty list, needs a value from the calling agent.
 * Every answer is read first, so the choice and scores of every question are
 * recorded even when the step ends without an action. They are recorded into
 * `record`, whose maps the result shares, as each is read: an answer that
 * throws leaves the ones read before it there.
 */
export function readArgumentAnswers(
  tool: ExecutableTool,
  argumentQuestions: readonly StageTwoQuestion[],
  answers: Record<string, unknown>,
  record: AnswerRecord = { choices: {}, probabilities: {} }
): ArgumentAnswers {
  const chosen: ChosenArguments = {
    args: {},
    chosen: {},
    choices: record.choices,
    probabilities: record.probabilities,
    lists: {},
  };
  const choicePicks: { question: ArgumentQuestion; option: ArgumentOption }[] =
    [];
  const listPicks: ListValuePick[] = [];
  for (const question of argumentQuestions) {
    if (question.type === "noul")
      listPicks.push({
        question,
        score: readListValue(question, answers, chosen),
      });
    else
      choicePicks.push({
        question,
        option: readPick(question, answers, chosen),
      });
  }

  const required = (parameter: string) =>
    tool.args.some((arg) => arg.name === parameter && !arg.optional);
  const needsValue = (parameter: string): ArgumentAnswers => ({
    kind: "needs_value",
    parameter,
    choices: chosen.choices,
    probabilities: chosen.probabilities,
  });

  // Only a `ref` is chunked and an operation has one, so at most one run-off.
  let runOff: ArgumentQuestion | undefined;
  for (const [parameter, group] of groupByParameter(choicePicks)) {
    const named = group.filter((pick) => "value" in pick.option);
    // A lone question: an option without a value leaves the parameter unset,
    // or, for a required one, says no Goal Value fits it.
    if (group.length === 1) {
      if (named.length === 0 && required(parameter))
        return needsValue(parameter);
      choose(chosen, group[0]!.question, group[0]!.option);
      continue;
    }
    if (named.length === 0)
      return {
        kind: "none_fits",
        parameter,
        choices: chosen.choices,
        probabilities: chosen.probabilities,
      };
    if (named.length === 1)
      choose(chosen, named[0]!.question, named[0]!.option);
    else
      runOff = runOffQuestion(
        tool,
        group[0]!.question,
        named.map((pick) => pick.option)
      );
  }

  for (const [parameter, group] of groupByParameter(listPicks)) {
    const included = group.filter((pick) => pick.score >= 0.5);
    if (included.length > 0) chooseList(chosen, parameter, included);
    // An optional list nothing belongs in stays unset.
    else if (required(parameter)) return needsValue(parameter);
  }

  return runOff
    ? { kind: "run_off", chosen, question: runOff }
    : { kind: "chosen", chosen };
}

function groupByParameter<T extends { question: QuestionBase }>(
  picks: readonly T[]
): Map<string, T[]> {
  const byParameter = new Map<string, T[]>();
  for (const pick of picks) {
    const group = byParameter.get(pick.question.parameter) ?? [];
    group.push(pick);
    byParameter.set(pick.question.parameter, group);
  }
  return byParameter;
}

/** Read the run-off's answer and complete the arguments with it. */
export function readRunOffAnswer(
  runOff: Extract<ArgumentAnswers, { kind: "run_off" }>,
  answers: Record<string, unknown>
): ChosenArguments {
  const chosen: ChosenArguments = {
    args: structuredClone(runOff.chosen.args),
    chosen: { ...runOff.chosen.chosen },
    choices: { ...runOff.chosen.choices },
    probabilities: { ...runOff.chosen.probabilities },
    lists: { ...runOff.chosen.lists },
  };
  const option = readPick(runOff.question, answers, chosen);
  choose(chosen, runOff.question, option);
  return chosen;
}

/**
 * A select element that holds one option at a time is sent one value: of a
 * list sent to it, only the Goal Value scored highest is kept, the first of
 * them on a tie. Applied once the element the operation acts on is chosen.
 * `select_option` is the Browser Tool this is for.
 */
export function fitListsToTarget(
  tool: ExecutableTool,
  chosen: ChosenArguments,
  capture: PageStateCapture
): void {
  const target = tool.args.find((arg) => arg.closedSet?.kind === "ref");
  const ref = target && chosen.args[target.name];
  const element =
    ref === undefined ? undefined : capture.elementsByRef.get(ref as AriaRef);
  if (!(element instanceof HTMLSelectElement) || element.multiple) return;
  for (const [parameter, picks] of Object.entries(chosen.lists)) {
    const top = picks.reduce((best, pick) =>
      pick.score > best.score ? pick : best
    );
    chooseList(chosen, parameter, [top]);
  }
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
