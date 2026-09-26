import {
  projectStructuralNodeForest,
  renderJsonStructuralNodeForest,
  renderTreeOutput,
  structuralNodeForest,
  type JsonStructuralNodeForest,
  type ProjectedStructuralNodeForest,
  type StructuralNode,
  type StructuralNodeForest,
  type StructuralTree,
  type TreeOutput,
} from "@ayme-dev/core/structural-observation";
import type { JsonPrimitive, JsonSchema, ToolParameter } from "./contracts";
import type { DecisionQuestions, DecisionRequest } from "./decisionTypes";
import type { AriaRef, PageStateCapture } from "./pageState";
import { listRefTools } from "./refTools";
import {
  listCollectionToolRoots,
  listCallerAwarePomTools,
  type RegisteredPomRoot,
} from "./registry";

/**
 * What the Goal Loop asks the model, and how an answer maps back to what it
 * offered. The loop itself owns only the sequence of steps.
 */

const DECISION_MODEL = "typesafe/jev-1.13";

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

// --- Question ids ---
//
// A question is normally identified by its parameter's name. A ref parameter
// over the cap is asked as several questions, so those carry ids of their own:
// the parameter's name, a separator, then the chunk's ordinal or "run_off".
// The separator is lengthened until no parameter name of the operation starts
// with the parameter's name and it, so these ids never equal a parameter name
// (#141). An answer is mapped back through `ArgumentQuestion.parameter`, never
// by reading its id.

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

const parameterNamesOf = (tool: ExecutableTool) =>
  tool.args.map((arg) => arg.name);

// --- Operations offered in stage one ---

/** A closed set of values the model may pick one of. */
type ClosedSet =
  | { kind: "ref"; filter: (element: Element) => boolean }
  /** The present roots of one collection path; no filter is involved. */
  | { kind: "instance"; roots: readonly RegisteredPomRoot[] }
  | { kind: "values"; values: readonly JsonPrimitive[] };

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
};

export type ExecutableTool = {
  name: string;
  description: string;
  /** Runs the tool as the Goal Loop's model, the caller of every step. */
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
  const refTools: ExecutableTool[] = listRefTools().map(
    ({ tool, filter, executeAs }) => ({
      name: tool.name,
      description: tool.description,
      execute: (input: unknown) => executeAs(input, "goalLoop"),
      requiredParams: [...(tool.inputSchema.required ?? [])],
      args: specsOfRefToolSchema(tool.inputSchema, filter),
    })
  );
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
      execute: (input: unknown) =>
        t.executeAs(
          roots ? { args: {}, ...(input as Record<string, unknown>) } : input,
          "goalLoop"
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
   * The argument this option stands for; absent means the option names no
   * argument ("leave unset", "none of these"). A ref option carries the
   * branded Structural Ref of the capture it was built from, so an answer
   * never becomes a ref string parsed from model output.
   */
  value?: AriaRef | JsonPrimitive;
};

export type ArgumentQuestion = {
  /**
   * The question id in the request. It is the parameter's name, except for a
   * ref parameter whose elements outnumber the cap: each chunk of its options
   * is one question (`chunkQuestionId`), and a run-off among the chunks'
   * answers is another (`runOffQuestionId`). Neither equals a parameter name.
   */
  id: string;
  /** The parameter the answer fills: its name, dotted inside a nested object. */
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
  /** No element on the page is one the operation's ref may address. */
  | { kind: "needs_ref_choice"; parameter: string }
  /** The instances of a collection do not make a choice the model can answer. */
  | { kind: "needs_instance_choice"; parameter: string; optionCount: number }
  /** The values of a closed set do not make a choice the model can answer. */
  | { kind: "needs_value_choice"; parameter: string; optionCount: number };

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

    const options = withUniqueKeys([
      ...(closedSet.kind === "ref"
        ? refOptions(closedSet.filter, capture)
        : closedSet.kind === "instance"
          ? instanceOptions(closedSet.roots, capture)
          : valueOptions(closedSet.values)),
      ...(arg.optional
        ? [
            {
              key: LEAVE_UNSET_KEY,
              description: `Leave "${arg.name}" unset; the operation uses its default.`,
            },
          ]
        : []),
    ]);

    // A ref whose elements outnumber the cap is asked in chunks (#123). The
    // other closed sets are not, yet: #130.
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
 * rendered as JSON. The rendered page travels inside the decision request, so
 * its serializer is the request's own JSON serialization, applied by the
 * decision function to the whole request rather than here.
 */
const pageOutput: TreeOutput<
  StructuralNodeForest<StructuralNode>,
  ProjectedStructuralNodeForest,
  JsonStructuralNodeForest
> = {
  projection: (forest) => projectStructuralNodeForest(forest),
  renderer: renderJsonStructuralNodeForest,
  serializer: (page) => JSON.stringify(page),
};

/**
 * The page as the model is shown it: the full capture's root nodes with the
 * prunable nodes exploded, then `pageOutput`. This forest is derived for
 * serialization only; the ref options and the Change Record keep walking the
 * full capture, so the refs the model reads are the capture's.
 * (`pageState.ts` and `changeRecord.ts` still compose the stages by hand; they
 * adopt them under #119.)
 */
function renderPage(pageTree: StructuralTree): JsonStructuralNodeForest {
  const shown = structuralNodeForest(pageTree.getRootNodes()).explode(
    (_entry, node) => prunable(node)
  );
  return renderTreeOutput(pageOutput, shown);
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

  return { model: DECISION_MODEL, state, questions };
}

/**
 * Stage two: the chosen operation's arguments, asked in parallel. The chunks of
 * a ref over the cap are questions like any other, so they travel in the same
 * request with the page state sent once. A run-off is the same request shape
 * with its one question.
 */
export function buildArgumentRequest(
  state: StepState,
  argumentQuestions: readonly ArgumentQuestion[]
): DecisionRequest {
  const questions: DecisionQuestions = {};
  for (const question of argumentQuestions) {
    const criteria: Record<string, string> = {};
    for (const option of question.options)
      criteria[option.key] = option.description;
    questions[question.id] = {
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
  /** Per question id: the key of the option the model chose. */
  choices: Record<string, string>;
  /** Per question id: the scores, when the decision function supplied them. */
  probabilities: Record<string, Record<string, number>>;
};

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
  | ({ kind: "none_fits"; parameter: string } & AnswerRecord);

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

function choose(
  chosen: ChosenArguments,
  question: ArgumentQuestion,
  option: ArgumentOption
): void {
  assignAt(chosen.args, question.path, option.value);
  chosen.summary.push(`${question.parameter}: ${option.description}`);
}

/**
 * Map each answer back to one of the options that question offered. The
 * chunks of one parameter answer together: the one chunk that named an
 * element decides, several call for a run-off, none means no element fits.
 * Every answer is read first, so the choice and scores of every question are
 * recorded even when the step ends without an action. They are recorded into
 * `record`, whose maps the result shares, as each is read: an answer that
 * throws leaves the ones read before it there.
 */
export function readArgumentAnswers(
  tool: ExecutableTool,
  argumentQuestions: readonly ArgumentQuestion[],
  answers: Record<string, unknown>,
  record: AnswerRecord = { choices: {}, probabilities: {} }
): ArgumentAnswers {
  const chosen: ChosenArguments = {
    args: {},
    summary: [],
    choices: record.choices,
    probabilities: record.probabilities,
  };
  const picks = argumentQuestions.map((question) => ({
    question,
    option: readPick(question, answers, chosen),
  }));

  const byParameter = new Map<string, typeof picks>();
  for (const pick of picks) {
    const group = byParameter.get(pick.question.parameter) ?? [];
    group.push(pick);
    byParameter.set(pick.question.parameter, group);
  }

  // Only a `ref` is chunked and an operation has one, so at most one run-off.
  let runOff: ArgumentQuestion | undefined;
  for (const [parameter, group] of byParameter) {
    const named = group.filter((pick) => "value" in pick.option);
    // A lone question: an option without a value leaves the parameter unset.
    if (group.length === 1) {
      if (named[0]) choose(chosen, named[0].question, named[0].option);
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

  return runOff
    ? { kind: "run_off", chosen, question: runOff }
    : { kind: "chosen", chosen };
}

/** Read the run-off's answer and complete the arguments with it. */
export function readRunOffAnswer(
  runOff: Extract<ArgumentAnswers, { kind: "run_off" }>,
  answers: Record<string, unknown>
): ChosenArguments {
  const chosen: ChosenArguments = {
    args: structuredClone(runOff.chosen.args),
    summary: [...runOff.chosen.summary],
    choices: { ...runOff.chosen.choices },
    probabilities: { ...runOff.chosen.probabilities },
  };
  const option = readPick(runOff.question, answers, chosen);
  choose(chosen, runOff.question, option);
  return chosen;
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
