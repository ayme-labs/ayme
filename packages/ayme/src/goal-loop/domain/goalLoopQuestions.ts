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
import type {
  ChosenOption,
  GoalLoopStepRecord,
  GoalValues,
  JsonPrimitive,
} from "../../shared";
import type { DecisionQuestions, DecisionRequest } from "./decisionWire";
import type { AriaRef, PageStateCapture } from "../../page-state";
import { acceptedRefNodes } from "../../tools";
import type {
  ArgumentSpec,
  ClosedSet,
  FreeKind,
  GoalLoopOperation,
  PathKey,
  ToolOption,
  TupleSpec,
} from "./goalLoopOperations";
import type { RootedToolInstance } from "../../page-objects";

/**
 * What the Goal Loop asks the model, and how an answer maps back to what it
 * offered. The Step Decision (`stepDecision.ts`) puts these in order. By
 * convention it is the only production module that imports them: everything
 * else decides a step through `decideStep`. The exceptions are the question
 * ids and Goal Values, which a decision function and the Goal Loop see too.
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

const parameterNamesOf = (tool: GoalLoopOperation) =>
  tool.args.map((arg) => arg.name);

/**
 * The parameters a caller passes, for a handover: a tuple slot stands for its
 * outermost tuple, named once.
 */
function wholeParameters(args: readonly ArgumentSpec[]): string[] {
  return [
    ...new Set(
      args.map((arg) => (arg.tuples ? arg.tuples[0]!.path.join(".") : arg.name))
    ),
  ];
}

// --- Goal Values ---

/**
 * Goal Values: labelled strings or numbers the calling agent passes with a
 * goal, for the model to pick from where the page offers nothing to pick.
 */
// --- Arguments asked in stage two ---

type ArgumentOption = {
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
  path: readonly PathKey[];
  instructions: string;
};

/** One option to choose for a parameter, or for a chunk or run-off of a ref. */
export type ArgumentQuestion = QuestionBase & {
  type: "choice";
  options: ArgumentOption[];
  /**
   * Set on a question over the page's elements: a ref, its chunks and its
   * run-off. `receiving` names the Goal Values the operation will enter into
   * the element, when stage one already chose them.
   */
  target?: { receiving?: string };
  /**
   * Set on a question over a collection's items: the present items it does
   * not offer, and why.
   */
  leftOut?: LeftOutItem[];
};

/** A present collection item the loop did not offer, and why, as a fact. */
export type LeftOutItem = { label: string; why: string };

/**
 * The sentence naming the items a collection's question left out, each with
 * why. Empty when none was.
 */
export function describeLeftOut(leftOut: readonly LeftOutItem[]): string {
  if (leftOut.length === 0) return "";
  const named = leftOut.map(({ label, why }) => `${label} (${why})`);
  return `Left out: ${named.join(", ")}.`;
}

/** Whether one value or Goal Value belongs in a list parameter. */
type ListValueQuestion = QuestionBase & {
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
  /**
   * No element on the page is one the operation's ref may address; when
   * `unreachable` is set, that many match the operation's filter but a click
   * would reach none of them.
   */
  | { kind: "needs_ref_choice"; parameter: string; unreachable?: number }
  /** The instances of a collection do not make a choice the model can answer. */
  | {
      kind: "needs_instance_choice";
      parameter: string;
      optionCount: number;
      /** The present items the loop could not offer, and why. */
      leftOut: LeftOutItem[];
    }
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
 * capture gave that root's element. A root the tool is unavailable on would be
 * refused, and a root the capture holds no ref for cannot be targeted; both are
 * left out, each with why.
 */
function instanceOptions(
  roots: readonly RootedToolInstance[],
  capture: PageStateCapture
): { options: ArgumentOption[]; leftOut: LeftOutItem[] } {
  const refsByElement = new Map<Element, AriaRef>();
  for (const [ref, element] of capture.elementsByRef)
    refsByElement.set(element, ref);

  const options: ArgumentOption[] = [];
  const leftOut: LeftOutItem[] = [];
  for (const root of roots) {
    if (!root.available) {
      leftOut.push({
        label: root.label,
        why:
          root.reason === undefined
            ? "unavailable"
            : `unavailable: ${root.reason}`,
      });
      continue;
    }
    const ref = refsByElement.get(root.element);
    const node = ref === undefined ? null : capture.tree.getNode(ref);
    if (ref === undefined || node === null) {
      leftOut.push({ label: root.label, why: "no ref in the page state" });
      continue;
    }
    options.push({
      key: ref,
      description: `${root.label} (${describeNode(node)})`,
      value: ref,
    });
  }
  return { options, leftOut };
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
  kinds: readonly FreeKind[] | undefined,
  values: GoalValues
): ArgumentOption[] {
  if (!kinds) return [];
  return Object.entries(values)
    .filter(([, value]) => kinds.some((kind) => fits(kind, value)))
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

function describeOperation(tool: GoalLoopOperation): string {
  return `The operation is "${tool.name}": ${tool.description}`;
}

/**
 * The sentence every question about a ref parameter starts with. With the
 * Goal Values the operation will enter, the element is picked as the one that
 * should receive them.
 */
function pickElementSentence(parameter: string, receiving?: string): string {
  return receiving
    ? `Pick the element that should receive ${receiving}, as this operation's ${parameter} parameter.`
    : `Pick the element this operation acts on as its ${parameter} parameter.`;
}

function argumentInstructions(
  tool: GoalLoopOperation,
  arg: ArgumentSpec,
  receiving?: string
): string {
  const parameter = describeParameter(arg);
  const operation = describeOperation(tool);
  switch (arg.closedSet?.kind) {
    case "ref":
      return `${pickElementSentence(parameter, receiving)} ${operation}`;
    case "instance":
      return `Pick the instance this operation acts on as its ${parameter} parameter. ${operation}`;
    case undefined:
      return `Pick the Goal Value to use as the ${parameter} parameter of this operation. ${operation}`;
    default:
      return arg.free
        ? `Pick the value or Goal Value to use as the ${parameter} parameter of this operation. ${operation}`
        : `Pick the value for the ${parameter} parameter of this operation. ${operation}`;
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
  tool: GoalLoopOperation,
  arg: ArgumentSpec,
  options: readonly ArgumentOption[],
  receiving?: string
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
        `${pickElementSentence(parameter, receiving)} ` +
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
      target: receiving ? { receiving } : {},
    };
  });
}

/**
 * When several chunks each named an element, one more question offers exactly
 * those elements, and nothing else, so the model picks between them directly.
 */
function runOffQuestion(
  tool: GoalLoopOperation,
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
      (chunk.target?.receiving
        ? `Pick the one element that should receive ${chunk.target.receiving}, as this operation's "${chunk.parameter}" parameter. `
        : `Pick the one element this operation acts on as its "${chunk.parameter}" parameter. `) +
      describeOperation(tool),
    options: [...named],
    target: chunk.target ?? {},
  };
}

/**
 * A required choice of a collection item ends with an option that names no
 * item, and its instructions say when to choose it, so the model is never
 * made to act on an item the goal does not mean. An optional one says the
 * same by leaving the parameter unset. A ref within the cap gets none: on the
 * bench goal set, Jev answered it where an offered element fitted.
 */
function withNoneOfThese(
  arg: ArgumentSpec,
  kind: ClosedSet["kind"],
  question: { options: ArgumentOption[]; instructions: string }
): { options: ArgumentOption[]; instructions: string } {
  if (arg.optional || kind !== "instance") return question;
  return {
    options: [
      ...question.options,
      {
        key: NONE_OF_THESE_KEY,
        description: "None of these; the item is not offered.",
      },
    ],
    instructions: `${question.instructions} Choose "${NONE_OF_THESE_KEY}" when the item is not among these.`,
  };
}

/** The extra option of an optional parameter: leave it unset. */
const leaveUnsetOption = (arg: ArgumentSpec): ArgumentOption => ({
  key: LEAVE_UNSET_KEY,
  description: `Leave "${arg.name}" unset; the operation uses its default.`,
});

/**
 * One question per value of a list parameter's closed set and per Goal Value
 * that fits it, asked side by side: does this value belong in the list?
 */
function listValueQuestions(
  tool: GoalLoopOperation,
  arg: ArgumentSpec,
  values: GoalValues
): ListValueQuestion[] {
  const closedValues =
    arg.closedSet?.kind === "values" ? arg.closedSet.values : [];
  const closed = valueOptions(closedValues);
  // An answer is recorded by key, so `1` and `"1"` must not share one.
  const options = withUniqueKeys([
    ...closed,
    ...goalValueOptions(arg.free, values),
  ]);
  return options.map((option, index) => ({
    type: "noul",
    id: listValueQuestionId(arg.name, index + 1, parameterNamesOf(tool)),
    parameter: arg.name,
    path: arg.path,
    instructions:
      `Does ${index < closed.length ? "the value" : "the Goal Value"} "${option.description}" belong in the list ${describeParameter(arg)} of this operation? ` +
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
  tool: GoalLoopOperation,
  capture: PageStateCapture,
  values: GoalValues = {},
  presets: readonly ValuePreset[] = []
): ArgumentPlan {
  const unfilled = wholeParameters(
    tool.args.filter(
      (arg) =>
        !arg.optional &&
        arg.closedSet === null &&
        goalValueOptions(arg.free, values).length === 0
    )
  );
  if (unfilled.length > 0)
    return {
      kind: "needs_free_value",
      parameters: tool.requiredParams,
      unfilled,
    };

  const receiving = receivingPhrase(presets);
  const questions: StageTwoQuestion[] = [];
  for (const arg of tool.args) {
    // A list nothing can go in is optional by now, and left out.
    if (arg.list) {
      questions.push(...listValueQuestions(tool, arg, values));
      continue;
    }
    const closedSet = arg.closedSet;
    const goalValues = goalValueOptions(arg.free, values);
    if (!closedSet) {
      // Chosen in stage one: nothing left to ask.
      if (presets.some((preset) => preset.parameter === arg.name)) continue;
      const candidates = goalValues;
      // An optional parameter no Goal Value fits is left out.
      if (candidates.length === 0) continue;
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

    const offered: { options: ArgumentOption[]; leftOut?: LeftOutItem[] } =
      closedSet.kind === "ref"
        ? { options: refOptions(closedSet.filter, capture) }
        : closedSet.kind === "instance"
          ? instanceOptions(closedSet.roots, capture)
          : { options: valueOptions(closedSet.values) };
    const options = withUniqueKeys([
      ...offered.options,
      // A union of primitives offers its fitting Goal Values next to them.
      ...goalValues,
      ...(arg.optional ? [leaveUnsetOption(arg)] : []),
    ]);
    const asked = withNoneOfThese(arg, closedSet.kind, {
      options,
      instructions: argumentInstructions(tool, arg, receiving),
    });

    // A ref whose elements outnumber the cap is asked in chunks; other closed
    // sets are not.
    if (closedSet.kind === "ref" && options.length > MAX_CHOICE_OPTIONS) {
      questions.push(...chunkedRefQuestions(tool, arg, options, receiving));
      continue;
    }

    // A question outside the limit is never sent. An optional parameter the
    // loop cannot ask about is left unset, like the choice it would have had.
    if (options.length === 0 || asked.options.length > MAX_CHOICE_OPTIONS) {
      if (arg.optional) continue;
      // A ref gets here only with no element left to offer.
      if (closedSet.kind === "ref") {
        const unreachable = closedSet.matches
          ? acceptedRefNodes(closedSet.matches, capture).length
          : 0;
        return unreachable > 0
          ? { kind: "needs_ref_choice", parameter: arg.name, unreachable }
          : { kind: "needs_ref_choice", parameter: arg.name };
      }
      const parameter = wholeParameters([arg])[0]!;
      return offered.leftOut
        ? {
            kind: "needs_instance_choice",
            parameter,
            optionCount: options.length,
            leftOut: offered.leftOut,
          }
        : {
            kind: "needs_value_choice",
            parameter,
            optionCount: options.length,
          };
    }

    questions.push({
      type: "choice",
      id: arg.name,
      parameter: arg.name,
      path: arg.path,
      instructions: asked.instructions,
      options: asked.options,
      ...(closedSet.kind === "ref"
        ? { target: receiving ? { receiving } : {} }
        : {}),
      leftOut: offered.leftOut,
    });
  }
  return { kind: "ask", questions };
}

// --- Goal Values asked speculatively in stage one ---
//
// Stage two asks an operation's questions side by side, so its element would
// be picked without knowing the value it will receive. A free value is
// therefore asked in stage one, next to the operation, under an explicit
// premise: "if the next operation is one of these, which Goal Value does it
// take?". Code reads the answer only when the chosen operation is one the
// question covers; an answer naming no Goal Value leaves the parameter to
// stage two, asked as it is without speculation.

/** At most this many speculative questions ride along with the operation. */
const MAX_SPECULATIVE_QUESTIONS = 8;

/** The speculative answer for "the next operation is none of these". */
export const NO_VALUE_NEEDED_KEY = "no_value_needed";

/** A Goal Value question asked before the operation is chosen. */
type SpeculativeValueQuestion = {
  id: string;
  /** Per operation the question covers: the parameter the answer fills. */
  covers: readonly { operation: string; parameter: string }[];
  instructions: string;
  options: ArgumentOption[];
};

/** A free value chosen in stage one for the chosen operation. */
export type ValuePreset = {
  parameter: string;
  path: readonly PathKey[];
  option: ArgumentOption;
};

/**
 * The parameters a speculative question may cover: required, single free
 * values of one kind whose fitting Goal Values leave room in one question for
 * "no value needed" and "none of these". The others are asked in stage two.
 */
function speculativeArgs(tool: GoalLoopOperation, values: GoalValues) {
  return tool.args.filter((arg) => {
    if (
      arg.optional ||
      arg.closedSet !== null ||
      arg.list ||
      arg.free?.length !== 1
    )
      return false;
    const count = goalValueOptions(arg.free, values).length;
    return count > 0 && count + 2 <= MAX_CHOICE_OPTIONS;
  });
}

const quotedList = (names: readonly string[]) =>
  names.length === 1
    ? `"${names[0]}"`
    : `${names
        .slice(0, -1)
        .map((name) => `"${name}"`)
        .join(", ")} or "${names[names.length - 1]}"`;

const textNoun = (kind: FreeKind) => (kind === "string" ? "text" : "number");

/**
 * The speculative questions for the operations offered. The single-element
 * tools that take a free parameter of one name and kind share one question:
 * whichever of them runs, it enters that value into one element. Any other
 * operation's parameter is a question of its own. Questions are kept in the
 * order of the operations; past the cap, the parameters left out are asked in
 * stage two.
 */
export function buildSpeculativeValueQuestions(
  toolOptions: readonly ToolOption[],
  values: GoalValues = {}
): SpeculativeValueQuestion[] {
  type Group = {
    kind: FreeKind;
    arg: ArgumentSpec;
    tools: GoalLoopOperation[];
    tool?: GoalLoopOperation;
  };
  const groups = new Map<string, Group>();
  for (const { tool } of toolOptions) {
    const onElement = tool.args.some((arg) => arg.closedSet?.kind === "ref");
    for (const arg of speculativeArgs(tool, values)) {
      const kind = arg.free![0]!;
      const key = JSON.stringify(
        onElement ? ["element", arg.name, kind] : [tool.name, arg.name]
      );
      const group = groups.get(key);
      if (group) group.tools.push(tool);
      else if (groups.size < MAX_SPECULATIVE_QUESTIONS)
        groups.set(key, {
          kind,
          arg,
          tools: [tool],
          ...(onElement ? {} : { tool }),
        });
    }
  }

  const ids = new Set<string>();
  return [...groups.values()].map(({ kind, arg, tools, tool }) => {
    const operations = quotedList(tools.map((each) => each.name));
    const noun = textNoun(kind);
    let id = tool ? `value:${tool.name}.${arg.name}` : `value:${arg.name}`;
    while (ids.has(id)) id += "_";
    ids.add(id);
    return {
      id,
      covers: tools.map((each) => ({
        operation: each.name,
        parameter: arg.name,
      })),
      instructions: tool
        ? `If the next operation is ${operations} (${tool.description}), which Goal Value is its ${describeParameter(arg)} parameter?`
        : `If the next operation is ${operations} and enters ${kind === "string" ? "text" : "a number"} into one element of the page as its "${arg.name}" parameter, which Goal Value is that ${noun}?`,
      options: withUniqueKeys([
        ...goalValueOptions([kind], values),
        {
          key: NO_VALUE_NEEDED_KEY,
          description: `No value needed: the next operation is not ${operations}.`,
        },
        {
          key: NONE_OF_THESE_KEY,
          description: `None of these Goal Values is the ${tool ? `"${arg.name}" value` : noun} to enter.`,
        },
      ]),
    };
  });
}

/**
 * Read the speculative answers that apply to the chosen operation: one that
 * names a Goal Value presets its parameter. The answers to the questions that
 * do not cover it are not read.
 */
export function readSpeculativeValues(
  tool: GoalLoopOperation,
  questions: readonly SpeculativeValueQuestion[],
  answers: Record<string, unknown>,
  record: AnswerRecord
): ValuePreset[] {
  return questions.flatMap((question) => {
    const covered = question.covers.find(
      (cover) => cover.operation === tool.name
    );
    if (!covered) return [];
    const option = readPick(question, answers, record);
    const arg = tool.args.find((each) => each.name === covered.parameter);
    return "value" in option && arg
      ? [{ parameter: arg.name, path: arg.path, option }]
      : [];
  });
}

/** How the element question names the values stage one chose. */
function receivingPhrase(presets: readonly ValuePreset[]): string | undefined {
  if (presets.length === 0) return undefined;
  return presets
    .map(({ option }) =>
      typeof option.value === "string"
        ? `the text "${option.value}" (the Goal Value "${option.key}")`
        : `the number ${String(option.value)} (the Goal Value "${option.key}")`
    )
    .join(" and ");
}

/**
 * Complete the arguments once every one is chosen: add the values stage one
 * chose, keeping the step record's parameters in the operation's order, then
 * close the tuples (`completeTuples`), whose slots either stage may fill.
 */
export function completeArguments(
  tool: GoalLoopOperation,
  chosen: ChosenArguments,
  presets: readonly ValuePreset[]
): void {
  addValuePresets(tool, chosen, presets);
  completeTuples(tool, chosen);
}

function addValuePresets(
  tool: GoalLoopOperation,
  chosen: ChosenArguments,
  presets: readonly ValuePreset[]
): void {
  if (presets.length === 0) return;
  for (const { path, option } of presets)
    assignAt(chosen.args, path, option.value);
  const before = chosen.chosen;
  chosen.chosen = {};
  for (const arg of tool.args) {
    const preset = presets.find((each) => each.parameter === arg.name);
    const option = preset
      ? { key: preset.option.key, description: preset.option.description }
      : before[arg.name];
    if (option) chosen.chosen[arg.name] = option;
  }
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
 * (`structuralPageState.ts` and `changeRecord.ts` compose the stages by hand.)
 */
function renderPage(pageTree: StructuralTree): JsonStructuralNodeForest {
  const shown = structuralNodeForest(pageTree.getRootNodes()).explode(
    (_entry, node) => prunable(node)
  );
  return renderTree(pageRendering, shown);
}

/** The state of one step, as both stages of it are sent (or built from) it. */
export type StepState = {
  goal?: string;
  values?: GoalValues;
  history?: readonly GoalLoopStepRecord[];
  [field: string]: unknown;
};

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
  toolOptions: readonly ToolOption[],
  speculative: readonly SpeculativeValueQuestion[] = []
): DecisionRequest {
  const criteria: Record<string, string> = {};
  for (const option of toolOptions) criteria[option.key] = option.label;
  criteria["none"] = "No available operation fits the goal right now.";

  const questions: DecisionQuestions = {
    operation: {
      type: "choice",
      instructions:
        'Which operation moves closest to the goal? `history` lists the steps already taken, newest last, each with what it changed on the page. A step that changed the page has taken effect; do not choose it again unless the goal needs it a second time. Choose the operation for the next thing the goal still needs; choose "none" when nothing fits.',
      criteria,
    },
    goal_met: {
      type: "noul",
      instructions:
        "Has the goal been fully achieved on the current page? Judge from `page` and `history`.",
    },
    goal_remaining: {
      type: "noul",
      instructions:
        "Does the goal still need a step that has not run yet? Judge from `history` and `page`.",
    },
    ...Object.fromEntries(
      speculative.map((question) => [question.id, choiceQuestion(question)])
    ),
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
  argumentQuestions: readonly StageTwoQuestion[],
  capture?: PageStateCapture
): DecisionRequest {
  // A request that only picks an element is sent the candidates instead of
  // the page: the rest of the page is content unrelated to the decision.
  const targetOnly =
    capture !== undefined &&
    argumentQuestions.every(
      (question) => question.type === "choice" && question.target
    );
  const questions: DecisionQuestions = Object.fromEntries(
    argumentQuestions.map((question) => [
      question.id,
      question.type === "noul"
        ? { type: "noul", instructions: question.instructions }
        : choiceQuestion(
            targetOnly
              ? {
                  ...question,
                  instructions: `${question.instructions} ${CANDIDATES_SENTENCE}`,
                }
              : question
          ),
    ])
  );
  if (!targetOnly) return { state, questions };
  const refs = new Set(
    argumentQuestions.flatMap((question) =>
      question.type === "choice"
        ? question.options.flatMap((option) =>
            "value" in option ? [String(option.value)] : []
          )
        : []
    )
  );
  const { goal, values, history } = state;
  return {
    state: {
      goal,
      ...(values === undefined ? {} : { values }),
      history,
      elements: candidateElements(capture.tree, refs),
    },
    questions,
  };
}

/**
 * A choice as the request carries it. Built from entries, never by
 * assignment: a key is a Goal Value's label, which may be any string,
 * `__proto__` included.
 */
function choiceQuestion(question: {
  instructions: string;
  options: readonly ArgumentOption[];
}) {
  return {
    type: "choice",
    instructions: question.instructions,
    criteria: Object.fromEntries(
      question.options.map((option) => [option.key, option.description])
    ),
  };
}

const CANDIDATES_SENTENCE =
  "Each option is an element of `elements` in the state, matched by its `ref`: where it sits on the page and the text around it.";

/** At most this many characters of one text an element description quotes. */
const MAX_DESCRIPTION_TEXT = 120;

/** At most this many named ancestors an element description lists. */
const MAX_ANCESTORS = 3;

const clip = (text: string) =>
  text.length > MAX_DESCRIPTION_TEXT
    ? `${text.slice(0, MAX_DESCRIPTION_TEXT - 1)}…`
    : text;

/**
 * The candidate elements, in document order, each with what the tree carries
 * about it and around it: its named ancestors (outermost first), the nearest
 * heading and the nearest text before it, its own text (such as a textbox's
 * value), its properties and its state.
 */
function candidateElements(
  tree: StructuralTree,
  refs: ReadonlySet<string>
): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  let heading = "";
  let preceding = "";
  const visit = (
    child: StructuralNode["children"][number],
    parent: StructuralNode | null
  ) => {
    if (typeof child === "string") {
      // A candidate's own text describes it, not the next element.
      if (!(parent && refs.has(parent.ref)) && child.trim())
        preceding = child.trim();
      return;
    }
    if (refs.has(child.ref))
      elements.push(describeCandidate(tree, child, heading, preceding));
    if (child.role === "heading" && child.name)
      heading = preceding = child.name;
    for (const grandchild of child.children) visit(grandchild, child);
  };
  for (const root of tree.getRootNodes()) visit(root, null);
  return withItemTexts(tree, elements);
}

/**
 * Adds `item_text` to each named candidate whose role and name another
 * candidate shares: the text of the smallest ancestor that has text besides
 * the candidate and its name and holds none of the others, such as the row a
 * "Rename" button sits in.
 */
function withItemTexts(
  tree: StructuralTree,
  elements: Record<string, unknown>[]
): Record<string, unknown>[] {
  const groups = new Map<string, AriaRef[]>();
  // An unnamed candidate is told apart by the text around it already.
  for (const element of elements)
    if (element.name) {
      const label = `${element.role} ${element.name}`;
      const group = groups.get(label) ?? [];
      group.push(element.ref as AriaRef);
      groups.set(label, group);
    }
  const itemTexts = new Map<string, string>();
  for (const refs of groups.values()) {
    if (refs.length < 2) continue;
    // How many of the group each node holds, itself included.
    const held = new Map<string, number>();
    for (const ref of refs)
      for (const node of [ref, ...tree.getAncestorsOf(ref).map((a) => a.ref)])
        held.set(node, (held.get(node) ?? 0) + 1);
    for (const ref of refs) {
      const name = tree.getNode(ref)!.name;
      for (const ancestor of tree.getAncestorsOf(ref)) {
        if (held.get(ancestor.ref)! > 1) break;
        const text = itemText(ancestor, ref, name);
        if (text) {
          itemTexts.set(ref, clip(text));
          break;
        }
      }
    }
  }
  return elements.map((element) => {
    const text = itemTexts.get(element.ref as string);
    return text ? { ...element, item_text: text } : element;
  });
}

/**
 * The names and texts inside `item`, in document order, leaving out the
 * candidate and its name.
 */
function itemText(
  item: StructuralNode,
  candidate: AriaRef,
  candidateName: string
): string {
  const parts: string[] = [];
  // A heading repeating its region's name, or a name repeated as text, once.
  const add = (text: string) => {
    if (text && text !== candidateName && text !== parts.at(-1))
      parts.push(text);
  };
  const visit = (node: StructuralNode) => {
    if (node.ref === candidate) return;
    add(node.name);
    for (const child of node.children)
      if (typeof child === "string") add(child.trim());
      else visit(child);
  };
  visit(item);
  return parts.join(" · ");
}

function describeCandidate(
  tree: StructuralTree,
  node: StructuralNode,
  heading: string,
  preceding: string
): Record<string, unknown> {
  const ancestors = tree
    .getAncestorsOf(node.ref)
    .filter((ancestor) => ancestor.name !== "")
    .slice(0, MAX_ANCESTORS)
    .reverse();
  const text = node.children
    .filter((child): child is string => typeof child === "string")
    .join(" ")
    .trim();
  const state = Object.fromEntries(
    Object.entries(node.state).filter(([, value]) => value !== undefined)
  );
  const named = (text: string) =>
    text !== "" &&
    text !== node.name &&
    !ancestors.some((ancestor) => ancestor.name === text);
  return {
    ref: node.ref,
    role: node.role,
    name: node.name,
    ...(ancestors.length > 0 ? { within: ancestors.map(describeNode) } : {}),
    ...(named(heading) ? { heading: clip(heading) } : {}),
    ...(named(preceding) && preceding !== heading
      ? { preceding_text: clip(preceding) }
      : {}),
    ...(text ? { text: clip(text) } : {}),
    ...(Object.keys(node.props).length > 0 ? { props: node.props } : {}),
    ...(Object.keys(state).length > 0 ? { state } : {}),
  };
}

// --- Answers ---

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

/**
 * Extract the `goal_remaining` noul answer from the model response; undefined
 * when the response has none (a decision function that answers only the
 * questions it knows).
 */
export function parseGoalRemainingAnswer(
  answers: Record<string, unknown>
): NoulAnswer | undefined {
  if (!("goal_remaining" in answers)) return undefined;
  return readNoulAnswer(answers, "goal_remaining");
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
type ArgumentAnswers =
  /** Every parameter has its value: run the operation. */
  | { kind: "chosen"; chosen: ChosenArguments }
  /**
   * Several chunks of one parameter each named an element. `chosen` holds the
   * other parameters; `question` is the run-off to ask before running.
   */
  | { kind: "run_off"; chosen: ChosenArguments; question: ArgumentQuestion }
  /**
   * A required collection item answered "none of these", or every chunk of a
   * ref over the cap did. `leftOut` holds the items a collection's question did
   * not offer, and why.
   */
  | ({
      kind: "none_fits";
      parameter: string;
      leftOut: LeftOutItem[];
    } & AnswerRecord)
  /**
   * Nothing the question offered fits a required parameter, by the model's
   * answer. `goalValuesOffered` is false for a list asked only about its own
   * allowed values.
   */
  | ({
      kind: "needs_value";
      parameter: string;
      goalValuesOffered: boolean;
    } & AnswerRecord);

/**
 * The option the model picked for one question. Model output is never read as
 * a value of its own; an answer outside the offered options is an invalid
 * response. The chosen key, and the answer's scores when it has them, are
 * recorded under the question id.
 */
function readPick(
  question: Pick<ArgumentQuestion, "id" | "options">,
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
  tool: GoalLoopOperation,
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
  const allowedValueCount = (parameter: string) => {
    const closedSet = tool.args.find(
      (arg) => arg.name === parameter
    )?.closedSet;
    return closedSet?.kind === "values" ? closedSet.values.length : 0;
  };
  const picksItem = (parameter: string) =>
    tool.args.some(
      (arg) => arg.name === parameter && arg.closedSet?.kind === "instance"
    );
  const noneFits = (
    parameter: string,
    question: ArgumentQuestion
  ): ArgumentAnswers => ({
    kind: "none_fits",
    parameter,
    leftOut: question.leftOut ?? [],
    choices: chosen.choices,
    probabilities: chosen.probabilities,
  });
  const needsValue = (
    parameter: string,
    goalValuesOffered = true
  ): ArgumentAnswers => ({
    kind: "needs_value",
    parameter: wholeParameters(
      tool.args.filter((arg) => arg.name === parameter)
    )[0]!,
    goalValuesOffered,
    choices: chosen.choices,
    probabilities: chosen.probabilities,
  });

  // Only a `ref` is chunked and an operation has one, so at most one run-off.
  let runOff: ArgumentQuestion | undefined;
  for (const [parameter, group] of groupByParameter(choicePicks)) {
    const named = group.filter((pick) => "value" in pick.option);
    // A lone question: an option without a value leaves the parameter unset,
    // or, for a required one, says no item or no Goal Value fits it.
    if (group.length === 1) {
      if (named.length === 0 && required(parameter))
        return picksItem(parameter)
          ? noneFits(parameter, group[0]!.question)
          : needsValue(parameter);
      choose(chosen, group[0]!.question, group[0]!.option);
      continue;
    }
    if (named.length === 0) return noneFits(parameter, group[0]!.question);
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
    // An optional list nothing belongs in stays unset. Its own allowed values
    // are asked first, so any question past them offered a Goal Value.
    else if (required(parameter))
      return needsValue(parameter, group.length > allowedValueCount(parameter));
  }

  return runOff
    ? { kind: "run_off", chosen, question: runOff }
    : { kind: "chosen", chosen };
}

/**
 * Close the gaps the slots left unset leave in their tuples, innermost first:
 * a tuple ends at its first unset slot, an optional tuple that lacks a slot it
 * requires or ends up empty is left out, and a required tuple with no slot
 * set is empty. A
 * required tuple always has its required slots by now. A slot left without a
 * value, unset or dropped here, leaves the step record too, so a step reads
 * as what runs and a repeat is seen as one.
 */
function completeTuples(
  tool: GoalLoopOperation,
  { args, chosen }: ChosenArguments
): void {
  const tuples = new Map<string, TupleSpec>();
  for (const arg of tool.args)
    for (const tuple of arg.tuples ?? [])
      tuples.set(JSON.stringify(tuple.path), tuple);
  const innermostFirst = [...tuples.values()].sort(
    (a, b) => b.path.length - a.path.length
  );
  for (const { path, minItems, optional } of innermostFirst) {
    const parent = valueAt(args, path.slice(0, -1)) as
      Record<PathKey, unknown> | undefined;
    const key = path[path.length - 1]!;
    const tuple = parent?.[key];
    if (!Array.isArray(tuple)) {
      if (!optional) assignAt(args, path, []);
      continue;
    }
    const gap = tuple.findIndex((_, index) => !(index in tuple));
    if (gap !== -1) tuple.length = gap;
    // An optional tuple left empty is left out, the same call as one no
    // slot was set in.
    if (tuple.length < minItems || (optional && tuple.length === 0))
      delete parent![key];
  }
  for (const arg of tool.args)
    if (arg.tuples && valueAt(args, arg.path) === undefined)
      delete chosen[arg.name];
}

/** The value at `path` in the operation's input; a tuple's parent is never a list. */
function valueAt(args: Record<string, unknown>, path: readonly PathKey[]) {
  return path.reduce<unknown>(
    (value, key) => (value as Record<PathKey, unknown> | undefined)?.[key],
    args
  );
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
  tool: GoalLoopOperation,
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

/**
 * Put a chosen value where the operation's input expects it; a tuple slot's
 * index makes its tuple an array.
 */
function assignAt(
  args: Record<string, unknown>,
  path: readonly PathKey[],
  value: unknown
): void {
  let target = args as Record<PathKey, unknown>;
  for (const [index, key] of path.slice(0, -1).entries())
    target = (target[key] ??=
      typeof path[index + 1] === "number" ? [] : {}) as Record<
      PathKey,
      unknown
    >;
  target[path[path.length - 1]!] = value;
}
