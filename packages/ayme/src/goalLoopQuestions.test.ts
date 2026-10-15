// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { JsonSchema } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionWire";
import type { PageStateCapture } from "./pageState";
import {
  NONE_OF_THESE_KEY,
  buildArgumentRequest,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  specsOfParameters,
  type ArgumentQuestion,
  type GoalLoopOperation,
  type GoalValues,
} from "./goalLoopQuestions";

// --- Fixtures ---

/** A capture of `count` buttons in document order, refs e1..e<count>. */
function captureOfButtons(count: number): PageStateCapture {
  const yaml = Array.from(
    { length: count },
    (_, index) => `- button "Item ${index + 1}" [ref=e${index + 1}]`
  ).join("\n");
  const tree = StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
  const elementsByRef = new Map<AriaRef, Element>();
  for (let index = 1; index <= count; index++)
    elementsByRef.set(
      AriaRefSchema.parse(`e${index}`),
      document.createElement("button")
    );
  return { tree, elementsByRef };
}

const refArg = {
  name: "ref",
  path: ["ref"],
  optional: false,
  closedSet: { kind: "ref", filter: () => true },
} as const;

const clickTool: GoalLoopOperation = {
  name: "click",
  description: "Click an element.",
  execute: async () => null,
  requiredParams: ["ref"],
  args: [refArg],
};

/** A single-element tool with a boolean parameter next to its ref. */
const clickWithForceTool: GoalLoopOperation = {
  ...clickTool,
  name: "force_click",
  requiredParams: ["ref", "force"],
  args: [
    refArg,
    {
      name: "force",
      path: ["force"],
      optional: false,
      closedSet: { kind: "values", values: [true, false] },
    },
  ],
};

/**
 * A single-element tool whose other closed-set parameters are named like the first chunk
 * and the run-off of its `ref` would be under a naive `<parameter>_<suffix>`.
 */
const clickWithLookalikeParametersTool: GoalLoopOperation = {
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

function askedQuestions(
  tool: GoalLoopOperation,
  capture: PageStateCapture
): ArgumentQuestion[] {
  const plan = planArguments(tool, capture);
  if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
  return plan.questions.map((question) => {
    if (question.type !== "choice")
      throw new Error(`Unexpected ${question.type} question ${question.id}`);
    return question;
  });
}

/** The refs a question offers, in the order it offers them. */
function refsOf(question: ArgumentQuestion): string[] {
  return question.options.flatMap((option) =>
    "value" in option ? [String(option.value)] : []
  );
}

const idsOf = (questions: readonly ArgumentQuestion[]) =>
  questions.map((question) => question.id);

// --- Scripted decision function ---

/**
 * What to answer, per parameter: an option key, `"none"` for "none of these",
 * or one such entry per chunk of a parameter asked in chunks.
 */
type Script = Record<string, string | string[]>;

/**
 * Answer the questions from the script, with a probability of 1 on the chosen
 * key and 0 on the others, the way the decisions API scores a choice. The
 * chunks of one parameter take the script's entries in the order they are
 * asked.
 */
function scriptedDecision(
  questions: readonly ArgumentQuestion[],
  script: Script
) {
  const seen = new Map<string, number>();
  const wantedFor = (question: ArgumentQuestion): string => {
    const wanted = script[question.parameter];
    if (wanted === undefined)
      throw new Error(`No scripted answer for ${question.parameter}`);
    if (!Array.isArray(wanted)) return wanted;
    const nth = seen.get(question.parameter) ?? 0;
    seen.set(question.parameter, nth + 1);
    return wanted[nth] ?? "none";
  };
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const answers: Record<string, unknown> = {};
    for (const question of questions) {
      if (!(question.id in request.questions)) continue;
      const wanted = wantedFor(question);
      const keys = question.options.map((option) => option.key);
      const choice = wanted === "none" ? NONE_OF_THESE_KEY : wanted;
      const probabilities: Record<string, number> = {};
      for (const key of keys) probabilities[key] = key === choice ? 1 : 0;
      answers[question.id] = { type: "choice", choice, probabilities };
    }
    return { model: "typesafe/jev-1.13", answers };
  };
}

/** Plan, ask, and read the stage-two answers for a tool on a capture. */
async function askStageTwo(
  tool: GoalLoopOperation,
  capture: PageStateCapture,
  script: Script
) {
  const questions = askedQuestions(tool, capture);
  const request = buildArgumentRequest({}, questions);
  const response = await scriptedDecision(questions, script)(request);
  return {
    questions,
    request,
    answers: readArgumentAnswers(
      tool,
      questions,
      response.answers as Record<string, unknown>
    ),
  };
}

describe("ref questions over the option cap", () => {
  it("cuts the options into document-order chunks of at most 254 plus none of these", () => {
    const capture = captureOfButtons(600);

    const questions = askedQuestions(clickTool, capture);

    // ⌈600 / 254⌉ = 3 chunks, all for the one parameter, each with its own id.
    expect(questions).toHaveLength(3);
    expect(new Set(idsOf(questions)).size).toBe(3);
    expect(questions.every((question) => question.parameter === "ref")).toBe(
      true
    );
    for (const question of questions) {
      expect(refsOf(question).length).toBeLessThanOrEqual(254);
      expect(question.options.length).toBeLessThanOrEqual(255);
      // "None of these" is the last option of every chunk and names no ref.
      const last = question.options.at(-1)!;
      expect(last.key).toBe(NONE_OF_THESE_KEY);
      expect("value" in last).toBe(false);
      expect(question.instructions).toContain('"click"');
    }
    // Together the chunks hold every option exactly once, in document order.
    expect(questions.flatMap(refsOf)).toEqual(
      Array.from({ length: 600 }, (_, index) => `e${index + 1}`)
    );
  });

  it("takes one more chunk than would overflow: two chunks hold at most 508 elements", () => {
    const questions = askedQuestions(clickTool, captureOfButtons(509));

    expect(questions).toHaveLength(3);
    for (const question of questions)
      expect(question.options.length).toBeLessThanOrEqual(255);
  });

  it("sends every chunk in the one stage-two request", () => {
    const capture = captureOfButtons(300);
    const questions = askedQuestions(clickTool, capture);

    const request = buildArgumentRequest({ goal: "g" }, questions);

    // One request question per planned question, each within the cap.
    expect(Object.keys(request.questions)).toEqual(idsOf(questions));
    for (const question of Object.values(
      request.questions as Record<string, { criteria: object }>
    ))
      expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(255);
  });

  it("keeps a question within the cap as one question without none of these", () => {
    const capture = captureOfButtons(255);

    const questions = askedQuestions(clickTool, capture);

    expect(questions).toHaveLength(1);
    expect(questions[0]!.id).toBe("ref");
    expect(questions[0]!.parameter).toBe("ref");
    expect(questions[0]!.options).toHaveLength(255);
    expect(questions[0]!.options.every((option) => "value" in option)).toBe(
      true
    );
  });

  it("still reports zero options as a choice the model cannot make", () => {
    expect(planArguments(clickTool, captureOfButtons(0))).toEqual({
      kind: "needs_ref_choice",
      parameter: "ref",
    });
  });

  it("acts on the one chunk that names an element", async () => {
    const { questions, answers } = await askStageTwo(
      clickTool,
      captureOfButtons(600),
      { ref: ["none", "e300", "none"] }
    );

    expect(answers.kind).toBe("chosen");
    if (answers.kind !== "chosen") return;
    expect(answers.chosen.args).toEqual({ ref: "e300" });
    expect(answers.chosen.chosen).toEqual({
      ref: { key: "e300", description: 'button "Item 300"' },
    });
    // Every chunk's answer is recorded.
    expect(Object.keys(answers.chosen.probabilities)).toEqual(idsOf(questions));
  });

  it("asks a run-off among exactly the elements several chunks named", async () => {
    const { questions, answers } = await askStageTwo(
      clickTool,
      captureOfButtons(600),
      { ref: ["e10", "e300", "none"] }
    );

    expect(answers.kind).toBe("run_off");
    if (answers.kind !== "run_off") return;
    const { question } = answers;
    // A question of its own, for the same parameter.
    expect(idsOf(questions)).not.toContain(question.id);
    expect(question.parameter).toBe("ref");
    expect(question.path).toEqual(["ref"]);
    expect(refsOf(question)).toEqual(["e10", "e300"]);
    // The run-off offers no "none of these".
    expect(question.options.every((option) => "value" in option)).toBe(true);
    expect(question.instructions).toContain('"click"');

    const response = await scriptedDecision([question], { ref: "e300" })(
      buildArgumentRequest({}, [question])
    );
    const chosen = readRunOffAnswer(
      answers,
      response.answers as Record<string, unknown>
    );
    expect(chosen.args).toEqual({ ref: "e300" });
    expect(chosen.chosen).toEqual({
      ref: { key: "e300", description: 'button "Item 300"' },
    });
    // The chunk answers and the run-off answer are all recorded.
    expect(Object.keys(chosen.probabilities)).toEqual([
      ...idsOf(questions),
      question.id,
    ]);
    expect(chosen.probabilities[question.id]).toEqual({ e10: 0, e300: 1 });
  });

  it("rejects a run-off answer outside the elements it offered", async () => {
    const { answers } = await askStageTwo(clickTool, captureOfButtons(600), {
      ref: ["e10", "e300", "none"],
    });
    if (answers.kind !== "run_off") throw new Error(answers.kind);

    expect(() =>
      readRunOffAnswer(answers, {
        [answers.question.id]: { type: "choice", choice: "e20" },
      })
    ).toThrow(/not one of the offered options/);
  });

  it("reports that no element fits when every chunk answers none of these", async () => {
    const { questions, answers } = await askStageTwo(
      clickTool,
      captureOfButtons(600),
      { ref: ["none", "none", "none"] }
    );

    expect(answers.kind).toBe("none_fits");
    if (answers.kind !== "none_fits") return;
    expect(answers.parameter).toBe("ref");
    expect(Object.keys(answers.probabilities)).toEqual(idsOf(questions));
  });

  it("asks the operation's other parameters alongside the chunks", async () => {
    const { questions, request, answers } = await askStageTwo(
      clickWithForceTool,
      captureOfButtons(300),
      { ref: ["e5", "e299"], force: "true" }
    );

    expect(Object.keys(request.questions)).toEqual(idsOf(questions));
    expect(questions.map((question) => question.parameter)).toEqual([
      "ref",
      "ref",
      "force",
    ]);
    expect(answers.kind).toBe("run_off");
    if (answers.kind !== "run_off") return;
    // The other parameter is already chosen; the run-off adds the ref.
    expect(answers.chosen.args).toEqual({ force: true });

    const chosen = readRunOffAnswer(answers, {
      [answers.question.id]: { type: "choice", choice: "e5" },
    });
    expect(chosen.args).toEqual({ force: true, ref: "e5" });
    expect(chosen.chosen).toEqual({
      force: { key: "true", description: "true" },
      ref: { key: "e5", description: 'button "Item 5"' },
    });
  });
});

describe("question ids", () => {
  it("never share an id with a parameter of the operation", async () => {
    const { questions, request, answers } = await askStageTwo(
      clickWithLookalikeParametersTool,
      captureOfButtons(300),
      { ref: ["e5", "e299"], ref_1: "right", ref_run_off: "false" }
    );

    // Two chunks and the two other parameters: four questions, four ids.
    expect(questions.map((question) => question.parameter)).toEqual([
      "ref",
      "ref",
      "ref_1",
      "ref_run_off",
    ]);
    expect(Object.keys(request.questions)).toEqual(idsOf(questions));
    expect(new Set(idsOf(questions)).size).toBe(4);
    expect(answers.kind).toBe("run_off");
    if (answers.kind !== "run_off") return;
    expect(idsOf(questions)).not.toContain(answers.question.id);
    // Each answer fills the parameter its question belongs to.
    expect(answers.chosen.args).toEqual({ ref_1: "right", ref_run_off: false });

    const chosen = readRunOffAnswer(answers, {
      [answers.question.id]: { type: "choice", choice: "e299" },
    });
    expect(chosen.args).toEqual({
      ref: "e299",
      ref_1: "right",
      ref_run_off: false,
    });
  });
});

describe("collection instances over the option cap", () => {
  it("still hands over, naming the instance choice", () => {
    const capture = captureOfButtons(256);
    const roots = [...capture.elementsByRef.values()].map((element, index) => ({
      label: `items[${index}]`,
      element,
      present: true,
      available: true,
    }));
    const tool: GoalLoopOperation = {
      name: "List.archive",
      description: "Archive an item.",
      execute: async () => null,
      requiredParams: ["ref"],
      args: [
        {
          name: "ref",
          path: ["ref"],
          optional: false,
          closedSet: { kind: "instance", roots },
        },
      ],
    };

    expect(planArguments(tool, capture)).toEqual({
      kind: "needs_instance_choice",
      parameter: "ref",
      optionCount: 256,
    });
  });
});

describe("collection instances", () => {
  it("offers only the items the tool is available on", () => {
    const capture = captureOfButtons(2);
    const [first, second] = [...capture.elementsByRef.values()];
    const tool: GoalLoopOperation = {
      name: "List.archive",
      description: "Archive an item.",
      execute: async () => null,
      requiredParams: ["ref"],
      args: [
        {
          name: "ref",
          path: ["ref"],
          optional: false,
          closedSet: {
            kind: "instance",
            roots: [
              {
                label: "items[0]",
                element: first,
                present: true,
                available: false,
                reason: "already archived",
              },
              {
                label: "items[1]",
                element: second,
                present: true,
                available: true,
              },
            ],
          },
        },
      ],
    };

    const plan = planArguments(tool, capture);

    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    expect(plan.questions).toHaveLength(1);
    const [question] = plan.questions;
    if (question.type !== "choice")
      throw new Error(`Unexpected question ${question.type}`);
    expect(question.options).toEqual([
      { key: "e2", description: 'items[1] (button "Item 2")', value: "e2" },
    ]);
  });
});

describe("Goal Values", () => {
  /** A tool with a list parameter and one named like its first list question. */
  const tagTool: GoalLoopOperation = {
    name: "tag",
    description: "Tag the item.",
    execute: async () => null,
    requiredParams: ["labels"],
    args: [
      {
        name: "labels",
        path: ["labels"],
        optional: false,
        closedSet: null,
        free: ["string"],
        list: true,
      },
      {
        name: "labels_1",
        path: ["labels_1"],
        optional: true,
        closedSet: null,
        free: ["integer"],
      },
      { name: "options", path: ["options"], optional: true, closedSet: null },
    ],
  };

  it("asks one noul per string Goal Value of a list, with ids apart from every parameter", () => {
    const plan = planArguments(tagTool, captureOfButtons(0), {
      first: "urgent",
      count: 2,
      second: "billing",
    });

    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    expect(
      plan.questions.map(({ type, id, parameter }) => ({ type, id, parameter }))
    ).toEqual([
      { type: "noul", id: "labels__1", parameter: "labels" },
      { type: "noul", id: "labels__2", parameter: "labels" },
      { type: "choice", id: "labels_1", parameter: "labels_1" },
    ]);
  });

  it("keeps the list's included values in map order, and their scores", () => {
    const values = { first: "urgent", second: "billing", third: "spam" };
    const plan = planArguments(tagTool, captureOfButtons(0), values);
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);

    const answers = readArgumentAnswers(tagTool, plan.questions, {
      labels__1: { type: "noul", noul: 0.5 },
      labels__2: { type: "noul", noul: 0.49 },
      labels__3: { type: "noul", noul: 0.8 },
    });

    expect(answers).toMatchObject({
      kind: "chosen",
      chosen: {
        args: { labels: ["urgent", "spam"] },
        chosen: {
          labels: {
            key: "first, third",
            description: "first: urgent, third: spam",
          },
        },
        probabilities: {
          labels__1: { first: 0.5 },
          labels__2: { second: 0.49 },
          labels__3: { third: 0.8 },
        },
      },
    });
  });

  it("keeps a list value labelled __proto__ through the request and its answer", () => {
    const values = JSON.parse('{ "__proto__": "urgent" }') as GoalValues;
    const plan = planArguments(tagTool, captureOfButtons(0), values);
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);

    expect(
      Object.keys(buildArgumentRequest({}, plan.questions).questions)
    ).toEqual(["labels__1"]);
    const answers = readArgumentAnswers(tagTool, plan.questions, {
      labels__1: { type: "noul", noul: 0.9 },
    });
    expect(answers).toMatchObject({
      kind: "chosen",
      chosen: {
        args: { labels: ["urgent"] },
        chosen: {
          labels: { key: "__proto__", description: "__proto__: urgent" },
        },
      },
    });
    if (answers.kind !== "chosen") return;
    expect(Object.keys(answers.chosen.probabilities.labels__1!)).toEqual([
      "__proto__",
    ]);
  });

  it("hands a required parameter no Goal Value can fill to the calling agent", () => {
    const tool: GoalLoopOperation = {
      ...tagTool,
      requiredParams: ["options"],
      args: [
        {
          name: "options",
          path: ["options"],
          optional: false,
          closedSet: null,
        },
      ],
    };

    expect(planArguments(tool, captureOfButtons(0), { name: "Milk" })).toEqual({
      kind: "needs_free_value",
      parameters: ["options"],
      unfilled: ["options"],
    });
  });
});

describe("parameter shapes", () => {
  /** An action with the one parameter, classified as the loop reads it. */
  function actionWith(schema: JsonSchema, optional = false): GoalLoopOperation {
    const parameters = [{ name: "param", optional, schema }];
    return {
      name: "act",
      description: "Act on the page.",
      execute: async () => null,
      requiredParams: optional ? [] : ["param"],
      args: specsOfParameters(parameters),
    };
  }

  function plannedQuestions(tool: GoalLoopOperation, values: GoalValues) {
    const plan = planArguments(tool, captureOfButtons(0), values);
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    return plan.questions;
  }

  /** A noul answer per question id, from the score of the value it asks about. */
  function noulAnswers(
    questions: readonly { id: string; type: string }[],
    scores: readonly number[]
  ): Record<string, unknown> {
    return Object.fromEntries(
      questions.map((question, index) => [
        question.id,
        { type: "noul", noul: scores[index] },
      ])
    );
  }

  const enumList: JsonSchema = {
    type: "array",
    items: { type: "string", enum: ["low", "high"] },
  };

  it("asks one noul per enum value of an enum list, never a Goal Value", () => {
    const tool = actionWith(enumList);
    const questions = plannedQuestions(tool, { other: "urgent", extra: "low" });

    expect(
      questions.map((question) =>
        question.type === "noul" ? question.option : question
      )
    ).toEqual([
      { key: "low", description: "low", value: "low" },
      { key: "high", description: "high", value: "high" },
    ]);
    expect(questions[0]!.instructions).toContain('Does the value "low"');

    const answers = readArgumentAnswers(
      tool,
      questions,
      noulAnswers(questions, [0.2, 0.9])
    );
    expect(answers).toMatchObject({
      kind: "chosen",
      chosen: { args: { param: ["high"] } },
    });
  });

  it("asks about an enum list without any Goal Values", () => {
    expect(plannedQuestions(actionWith(enumList), {})).toHaveLength(2);
  });

  it("fills a number list from the numeric Goal Values, one noul each", () => {
    const tool = actionWith({ type: "array", items: { type: "number" } });
    const questions = plannedQuestions(tool, {
      name: "Milk",
      quantity: 2,
      price: 1.5,
    });

    expect(
      questions.map((question) =>
        question.type === "noul" ? question.option.key : question.id
      )
    ).toEqual(["quantity", "price"]);
    expect(
      readArgumentAnswers(tool, questions, noulAnswers(questions, [0.9, 0.7]))
    ).toMatchObject({ kind: "chosen", chosen: { args: { param: [2, 1.5] } } });
  });

  it("offers an integer list only the whole-number Goal Values", () => {
    const tool = actionWith({ type: "array", items: { type: "integer" } });
    const questions = plannedQuestions(tool, { quantity: 2, price: 1.5 });

    expect(questions).toHaveLength(1);
  });

  it("hands a required number list over when no numeric Goal Value fits", () => {
    const tool = actionWith({ type: "array", items: { type: "number" } });

    expect(planArguments(tool, captureOfButtons(0), { name: "Milk" })).toEqual({
      kind: "needs_free_value",
      parameters: ["param"],
      unfilled: ["param"],
    });
  });

  it("fills a tuple slot by slot: the enum slot by choice, the string slot from a Goal Value", async () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [
        { type: "string", enum: ["asc", "desc"] },
        { type: "string" },
      ],
      minItems: 2,
      maxItems: 2,
    });
    expect(tool.args.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: "param.0", path: ["param", 0] },
      { name: "param.1", path: ["param", 1] },
    ]);

    const questions = plannedQuestions(tool, { column: "price", count: 3 });
    expect(
      questions.map((question) =>
        question.type === "choice"
          ? question.options.map((option) => option.key)
          : []
      )
    ).toEqual([
      ["asc", "desc"],
      ["column", NONE_OF_THESE_KEY],
    ]);

    const answers = readArgumentAnswers(tool, questions, {
      "param.0": { type: "choice", choice: "desc" },
      "param.1": { type: "choice", choice: "column" },
    });
    expect(answers).toMatchObject({
      kind: "chosen",
      chosen: { args: { param: ["desc", "price"] } },
    });
    if (answers.kind === "chosen")
      expect(Array.isArray(answers.chosen.args.param)).toBe(true);
  });

  it("hands a required tuple over when no Goal Value fits a slot, naming the slot", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [{ type: "boolean" }, { type: "string" }],
      minItems: 2,
      maxItems: 2,
    });

    expect(planArguments(tool, captureOfButtons(0), { count: 3 })).toEqual({
      kind: "needs_free_value",
      parameters: ["param"],
      unfilled: ["param.1"],
    });
  });

  it("leaves an optional tuple out when a slot it requires stays unset", () => {
    const tool = actionWith(
      {
        type: "array",
        prefixItems: [
          { type: "string", enum: ["asc", "desc"] },
          { type: "string" },
        ],
        minItems: 2,
        maxItems: 2,
      },
      true
    );
    const questions = plannedQuestions(tool, { column: "price" });

    const answers = readArgumentAnswers(tool, questions, {
      "param.0": { type: "choice", choice: "asc" },
      "param.1": { type: "choice", choice: "leave_unset" },
    });
    expect(answers).toMatchObject({ kind: "chosen", chosen: { args: {} } });
  });

  it("ends a tuple at its first unset optional slot", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [
        { type: "string" },
        { type: "string", enum: ["a", "b"] },
        { type: "boolean" },
      ],
      minItems: 1,
      maxItems: 3,
    });
    const questions = plannedQuestions(tool, { name: "Milk" });

    const answers = readArgumentAnswers(tool, questions, {
      "param.0": { type: "choice", choice: "name" },
      "param.1": { type: "choice", choice: "leave_unset" },
      "param.2": { type: "choice", choice: "true" },
    });
    expect(answers).toMatchObject({
      kind: "chosen",
      chosen: { args: { param: ["Milk"] } },
    });
    if (answers.kind === "chosen")
      expect(answers.chosen.args.param).toHaveLength(1);
  });

  it("offers a union of primitives its booleans and the fitting string Goal Values in one question", () => {
    const tool = actionWith({
      anyOf: [{ type: "string" }, { type: "boolean" }],
    });
    const questions = plannedQuestions(tool, { name: "Milk", count: 2 });

    expect(questions).toHaveLength(1);
    const [question] = questions;
    if (question?.type !== "choice") throw new Error("Expected a choice");
    expect(question.options.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "true", value: true },
      { key: "false", value: false },
      { key: "name", value: "Milk" },
    ]);
    expect(
      readArgumentAnswers(tool, questions, {
        param: { type: "choice", choice: "name" },
      })
    ).toMatchObject({ kind: "chosen", chosen: { args: { param: "Milk" } } });
  });

  it("keeps a Goal Value labelled like a boolean apart from the boolean", () => {
    const tool = actionWith({
      anyOf: [{ type: "string" }, { type: "boolean" }],
    });
    const [question] = plannedQuestions(tool, { true: "yes" });
    if (question?.type !== "choice") throw new Error("Expected a choice");

    expect(question.options.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "true", value: true },
      { key: "false", value: false },
      { key: "true (2)", value: "yes" },
    ]);
  });

  it("hands a required map over and leaves an optional one out", () => {
    const map: JsonSchema = {
      type: "object",
      additionalProperties: { type: "string" },
    };

    expect(
      planArguments(actionWith(map), captureOfButtons(0), { name: "Milk" })
    ).toEqual({
      kind: "needs_free_value",
      parameters: ["param"],
      unfilled: ["param"],
    });
    expect(
      planArguments(actionWith(map, true), captureOfButtons(0), {
        name: "Milk",
      })
    ).toEqual({ kind: "ask", questions: [] });
  });

  it.each<[string, JsonSchema]>([
    ["booleans", { type: "array", items: { type: "boolean" } }],
    [
      "objects",
      {
        type: "array",
        items: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    [
      "lists",
      { type: "array", items: { type: "array", items: { type: "string" } } },
    ],
  ])(
    "hands a required list of %s over and leaves an optional one out",
    (_, schema) => {
      const values = { name: "Milk", count: 2 };
      expect(
        planArguments(actionWith(schema), captureOfButtons(0), values)
      ).toEqual({
        kind: "needs_free_value",
        parameters: ["param"],
        unfilled: ["param"],
      });
      expect(
        planArguments(actionWith(schema, true), captureOfButtons(0), values)
      ).toEqual({ kind: "ask", questions: [] });
    }
  );

  it("keeps string lists filled from string Goal Values only", () => {
    const tool = actionWith({ type: "array", items: { type: "string" } });
    const questions = plannedQuestions(tool, { name: "Milk", count: 2 });

    expect(
      questions.map((question) =>
        question.type === "noul" ? question.option.key : question.id
      )
    ).toEqual(["name"]);
    expect(questions[0]!.instructions).toContain(
      'Does the Goal Value "name: Milk"'
    );
  });
});
