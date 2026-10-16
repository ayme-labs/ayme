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
import type { CollectionToolItem } from "./registry";
import {
  NONE_OF_THESE_KEY,
  NO_VALUE_NEEDED_KEY,
  buildArgumentRequest,
  buildOperationRequest,
  buildSpeculativeValueQuestions,
  completeArguments,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  readSpeculativeValues,
  requiredParamsOf,
  specsOfParameters,
  type ArgumentQuestion,
  type GoalLoopOperation,
  type GoalValues,
  type StageTwoQuestion,
  type ToolOption,
  type ValuePreset,
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

describe("a required element choice", () => {
  it("offers none of these after a ref's elements", () => {
    const [question] = askedQuestions(clickTool, captureOfButtons(2));

    expect(question!.options.map((option) => option.key)).toEqual([
      "e1",
      "e2",
      NONE_OF_THESE_KEY,
    ]);
    expect("value" in question!.options.at(-1)!).toBe(false);
    expect(question!.instructions).toContain(`"${NONE_OF_THESE_KEY}"`);
  });

  it("reads none of these on a lone ref question as no element fitting", async () => {
    const { questions, answers } = await askStageTwo(
      clickTool,
      captureOfButtons(2),
      { ref: "none" }
    );

    expect(answers).toEqual({
      kind: "none_fits",
      parameter: "ref",
      leftOut: [],
      choices: { ref: NONE_OF_THESE_KEY },
      probabilities: {
        ref: Object.fromEntries(
          questions[0]!.options.map((option) => [
            option.key,
            option.key === NONE_OF_THESE_KEY ? 1 : 0,
          ])
        ),
      },
    });
  });
});

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

  it("keeps a question within the cap, none of these included, as one question", () => {
    const questions = askedQuestions(clickTool, captureOfButtons(254));

    expect(questions).toHaveLength(1);
    expect(questions[0]!.id).toBe("ref");
    expect(questions[0]!.parameter).toBe("ref");
    expect(questions[0]!.options).toHaveLength(255);
    expect(questions[0]!.options.at(-1)!.key).toBe(NONE_OF_THESE_KEY);
  });

  it("chunks a ref whose elements fill the cap without room for none of these", () => {
    const questions = askedQuestions(clickTool, captureOfButtons(255));

    expect(questions).toHaveLength(2);
    expect(questions.flatMap(refsOf)).toHaveLength(255);
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
      leftOut: [],
    });
  });
});

describe("collection instances", () => {
  /** A collection tool over `roots`, as the Goal Loop lists it. */
  const archiveTool = (
    roots: readonly CollectionToolItem[]
  ): GoalLoopOperation => ({
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
  });

  it("offers the items the tool is available on, then none of these, and keeps why the others were left out", () => {
    const capture = captureOfButtons(2);
    const [first, second] = [...capture.elementsByRef.values()];
    const tool = archiveTool([
      {
        label: "items[0]",
        element: first!,
        present: true,
        available: false,
        reason: "already archived",
      },
      { label: "items[1]", element: second!, present: true, available: true },
      // An available item the capture holds no ref for.
      {
        label: "items[2]",
        element: document.createElement("li"),
        present: true,
        available: true,
      },
      // Unavailable without an Availability Reason.
      {
        label: "items[3]",
        element: document.createElement("li"),
        present: true,
        available: false,
      },
    ]);

    const [question] = askedQuestions(tool, capture);

    expect(question!.options).toEqual([
      { key: "e2", description: 'items[1] (button "Item 2")', value: "e2" },
      {
        key: NONE_OF_THESE_KEY,
        description: "None of these; the item is not offered.",
      },
    ]);
    expect(question!.leftOut).toEqual([
      { label: "items[0]", why: "unavailable: already archived" },
      { label: "items[2]", why: "no ref in the page state" },
      { label: "items[3]", why: "unavailable" },
    ]);
  });

  it("hands the left-out items on when the model answers none of these", async () => {
    const capture = captureOfButtons(2);
    const [first, second] = [...capture.elementsByRef.values()];
    const tool = archiveTool([
      {
        label: "items[0]",
        element: first!,
        present: true,
        available: false,
        reason: "already archived",
      },
      { label: "items[1]", element: second!, present: true, available: true },
    ]);

    const { answers } = await askStageTwo(tool, capture, { ref: "none" });

    expect(answers).toMatchObject({
      kind: "none_fits",
      parameter: "ref",
      leftOut: [{ label: "items[0]", why: "unavailable: already archived" }],
    });
  });

  it("names the items it left out when none can be offered", () => {
    const capture = captureOfButtons(1);
    const tool = archiveTool([
      {
        label: "items[0]",
        element: document.createElement("li"),
        present: true,
        available: true,
      },
      {
        label: "items[1]",
        element: [...capture.elementsByRef.values()][0]!,
        present: true,
        available: false,
        reason: "already archived",
      },
    ]);

    expect(planArguments(tool, capture)).toEqual({
      kind: "needs_instance_choice",
      parameter: "ref",
      optionCount: 0,
      leftOut: [
        { label: "items[0]", why: "no ref in the page state" },
        { label: "items[1]", why: "unavailable: already archived" },
      ],
    });
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

  /** The arguments once stage two's answers, and stage one's presets, are in. */
  function completedArgs(
    tool: GoalLoopOperation,
    questions: readonly StageTwoQuestion[],
    answers: Record<string, unknown>,
    presets: readonly ValuePreset[] = []
  ) {
    const read = readArgumentAnswers(tool, questions, answers);
    if (read.kind !== "chosen") throw new Error(read.kind);
    completeArguments(tool, read.chosen, presets);
    return read.chosen.args;
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

  it("hands a required tuple over when no Goal Value fits a slot, naming the tuple", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [{ type: "boolean" }, { type: "string" }],
      minItems: 2,
      maxItems: 2,
    });

    expect(planArguments(tool, captureOfButtons(0), { count: 3 })).toEqual({
      kind: "needs_free_value",
      parameters: ["param"],
      unfilled: ["param"],
    });
  });

  it("names the whole tuple when the model finds no Goal Value for a slot", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [
        { type: "string", enum: ["asc", "desc"] },
        { type: "string" },
      ],
      minItems: 2,
      maxItems: 2,
    });
    const questions = plannedQuestions(tool, { column: "price" });

    expect(
      readArgumentAnswers(tool, questions, {
        "param.0": { type: "choice", choice: "asc" },
        "param.1": { type: "choice", choice: NONE_OF_THESE_KEY },
      })
    ).toMatchObject({ kind: "needs_value", parameter: "param" });
  });

  it("names a tuple inside an object by its whole path", () => {
    const tuple = { path: ["args", "coords"], minItems: 2, optional: false };
    const slot = (index: number) => ({
      name: `args.coords.${index}`,
      path: ["args", "coords", index],
      optional: false,
      closedSet: null,
      free: ["number"] as const,
      tuples: [tuple],
    });
    const tool: GoalLoopOperation = {
      ...actionWith({ type: "string" }),
      args: [slot(0), slot(1)],
    };

    expect(planArguments(tool, captureOfButtons(0), {})).toMatchObject({
      unfilled: ["args.coords"],
    });
  });

  it("passes a required tuple with no slot set as an empty tuple", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [{ type: "string" }],
      maxItems: 1,
    });
    const questions = plannedQuestions(tool, { count: 3 });

    expect(questions).toEqual([]);
    expect(completedArgs(tool, questions, {})).toEqual({ param: [] });
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

    expect(
      completedArgs(tool, questions, {
        "param.0": { type: "choice", choice: "asc" },
        "param.1": { type: "choice", choice: "leave_unset" },
      })
    ).toEqual({});
  });

  it("leaves an optional tuple out when every slot stays unset", () => {
    const tool = actionWith(
      {
        type: "array",
        prefixItems: [{ type: "string", enum: ["asc", "desc"] }],
        minItems: 1,
        maxItems: 1,
      },
      true
    );
    const questions = plannedQuestions(tool, {});

    expect(
      completedArgs(tool, questions, {
        "param.0": { type: "choice", choice: "leave_unset" },
      })
    ).toEqual({});
  });

  it("leaves out an optional tuple that ends up empty, like one with nothing set", () => {
    const tool = actionWith(
      {
        type: "array",
        prefixItems: [{ type: "boolean" }, { type: "boolean" }],
        maxItems: 2,
      },
      true
    );
    const questions = plannedQuestions(tool, {});

    expect(
      completedArgs(tool, questions, {
        "param.0": { type: "choice", choice: "leave_unset" },
        "param.1": { type: "choice", choice: "true" },
      })
    ).toEqual({});
  });

  it("keeps an optional tuple with a slot set, and a required one cut to empty", () => {
    const schema: JsonSchema = {
      type: "array",
      prefixItems: [{ type: "boolean" }, { type: "boolean" }],
      maxItems: 2,
    };
    const optional = actionWith(schema, true);
    const required = actionWith(schema);

    expect(
      completedArgs(optional, plannedQuestions(optional, {}), {
        "param.0": { type: "choice", choice: "true" },
        "param.1": { type: "choice", choice: "leave_unset" },
      })
    ).toEqual({ param: [true] });
    expect(
      completedArgs(required, plannedQuestions(required, {}), {
        "param.0": { type: "choice", choice: "leave_unset" },
        "param.1": { type: "choice", choice: "true" },
      })
    ).toEqual({ param: [] });
  });

  it("completes nested tuples innermost first", () => {
    // [[string, string], "a" | "b"]?: the inner tuple misses a slot, so it is
    // left out, which leaves the outer tuple without a slot it requires.
    const tool = actionWith(
      {
        type: "array",
        prefixItems: [
          {
            type: "array",
            prefixItems: [{ type: "string" }, { type: "string" }],
            minItems: 2,
            maxItems: 2,
          },
          { type: "string", enum: ["a", "b"] },
        ],
        minItems: 2,
        maxItems: 2,
      },
      true
    );
    expect(tool.args.map((arg) => arg.name)).toEqual([
      "param.0.0",
      "param.0.1",
      "param.1",
    ]);
    const questions = plannedQuestions(tool, { name: "Milk" });

    expect(
      completedArgs(tool, questions, {
        "param.0.0": { type: "choice", choice: "name" },
        "param.0.1": { type: "choice", choice: "leave_unset" },
        "param.1": { type: "choice", choice: "a" },
      })
    ).toEqual({});
    expect(
      completedArgs(tool, questions, {
        "param.0.0": { type: "choice", choice: "leave_unset" },
        "param.0.1": { type: "choice", choice: "leave_unset" },
        "param.1": { type: "choice", choice: "leave_unset" },
      })
    ).toEqual({});
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

    const read = readArgumentAnswers(tool, questions, {
      "param.0": { type: "choice", choice: "name" },
      "param.1": { type: "choice", choice: "leave_unset" },
      "param.2": { type: "choice", choice: "true" },
    });
    if (read.kind !== "chosen") throw new Error(read.kind);
    completeArguments(tool, read.chosen, []);

    expect(read.chosen.args).toEqual({ param: ["Milk"] });
    // The step record shows what runs, so a repeat reads as one.
    expect(Object.keys(read.chosen.chosen)).toEqual(["param.0"]);

    const again = readArgumentAnswers(tool, questions, {
      "param.0": { type: "choice", choice: "name" },
      "param.1": { type: "choice", choice: "leave_unset" },
      "param.2": { type: "choice", choice: "leave_unset" },
    });
    if (again.kind !== "chosen") throw new Error(again.kind);
    completeArguments(tool, again.chosen, []);
    expect(again.chosen.chosen).toEqual(read.chosen.chosen);
  });

  it("names the whole tuple when a slot's enum is too large to ask", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [
        {
          type: "string",
          enum: Array.from({ length: 256 }, (_, index) => `v${index}`),
        },
      ],
      minItems: 1,
      maxItems: 1,
    });

    expect(planArguments(tool, captureOfButtons(0), {})).toMatchObject({
      kind: "needs_value_choice",
      parameter: "param",
    });
  });

  it("requires a collection tool's ref and the required parameters in its args, whole", () => {
    expect(
      requiredParamsOf(
        [
          { name: "ref", optional: false, schema: { type: "string" } },
          {
            name: "args",
            optional: false,
            schema: {
              type: "object",
              properties: {
                value: {
                  type: "array",
                  prefixItems: [{ type: "string" }],
                  maxItems: 1,
                },
                payload: { type: "object", properties: {} },
                note: { type: "string" },
              },
              required: ["value", "payload"],
            },
          },
        ],
        true
      )
    ).toEqual(["ref", "args.value", "args.payload"]);
    expect(
      requiredParamsOf(
        [
          { name: "value", optional: false, schema: { type: "string" } },
          { name: "note", optional: true, schema: { type: "string" } },
        ],
        false
      )
    ).toEqual(["value"]);
  });

  it("keeps enum list values that print alike apart", () => {
    const tool = actionWith({
      type: "array",
      items: {
        anyOf: [
          { type: "number", enum: [1] },
          { type: "string", enum: ["1"] },
        ],
      },
    });
    const questions = plannedQuestions(tool, {});

    expect(
      questions.map((question) =>
        question.type === "noul"
          ? [question.option.key, question.option.value]
          : []
      )
    ).toEqual([
      ["1", 1],
      ["1 (2)", "1"],
    ]);
  });

  it("keeps a tuple whose slots the two stages filled between them", () => {
    const tool = actionWith({
      type: "array",
      prefixItems: [
        { type: "string", enum: ["asc", "desc"] },
        { type: "string" },
      ],
      minItems: 2,
      maxItems: 2,
    });
    const [slot] = tool.args.filter((arg) => arg.name === "param.1");
    const presets: ValuePreset[] = [
      {
        parameter: slot!.name,
        path: slot!.path,
        option: { key: "column", description: "column: price", value: "price" },
      },
    ];
    const plan = planArguments(
      tool,
      captureOfButtons(0),
      { column: "price" },
      presets
    );
    if (plan.kind !== "ask") throw new Error(plan.kind);
    expect(plan.questions.map((question) => question.id)).toEqual(["param.0"]);

    expect(
      completedArgs(
        tool,
        plan.questions,
        { "param.0": { type: "choice", choice: "desc" } },
        presets
      )
    ).toEqual({ param: ["desc", "price"] });
  });

  it("offers a union of primitives its booleans and the fitting string Goal Values in one question", () => {
    const tool = actionWith({
      anyOf: [{ type: "string" }, { type: "boolean" }],
    });
    const questions = plannedQuestions(tool, { name: "Milk", count: 2 });

    expect(questions).toHaveLength(1);
    const [question] = questions;
    if (question?.type !== "choice") throw new Error("Expected a choice");
    expect(question.instructions).toMatch(/^Pick the value or Goal Value /);
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

  it("offers a union of string and number every Goal Value of either type", () => {
    const tool = actionWith({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    const [question] = plannedQuestions(tool, { name: "Milk", count: 2 });
    if (question?.type !== "choice") throw new Error("Expected a choice");

    expect(question.options.map((option) => option.key)).toEqual([
      "name",
      "count",
      NONE_OF_THESE_KEY,
    ]);
  });

  it("offers null as the closed value of a nullable union", () => {
    const tool = actionWith({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    const [question] = plannedQuestions(tool, { name: "Milk" });
    if (question?.type !== "choice") throw new Error("Expected a choice");

    expect(question.options.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "null", value: null },
      { key: "name", value: "Milk" },
    ]);
  });

  it("hands over a required union with a variant that is not a primitive", () => {
    const tool = actionWith({
      anyOf: [
        { type: "string" },
        { type: "object", properties: {}, additionalProperties: false },
      ],
    });

    expect(planArguments(tool, captureOfButtons(0), { name: "Milk" })).toEqual({
      kind: "needs_free_value",
      parameters: ["param"],
      unfilled: ["param"],
    });
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

describe("Goal Values asked speculatively in stage one", () => {
  const textArg = {
    name: "text",
    path: ["text"],
    optional: false,
    closedSet: null,
    free: ["string"],
  } as const;
  const elementTool = (name: string): GoalLoopOperation => ({
    name,
    description: `${name} text into one element.`,
    execute: async () => null,
    requiredParams: ["ref", "text"],
    args: [refArg, textArg],
  });
  const typeTool = elementTool("type");
  const fillTool = elementTool("fill");
  /** A Page Object tool with a required name, an optional note and a list. */
  const pomTool = (name: string): GoalLoopOperation => ({
    name,
    description: `Do ${name}.`,
    execute: async () => null,
    requiredParams: ["name"],
    args: [
      {
        name: "name",
        path: ["name"],
        optional: false,
        closedSet: null,
        free: ["string"],
        description: "The item's name.",
      },
      {
        name: "note",
        path: ["note"],
        optional: true,
        closedSet: null,
        free: ["string"],
      },
      {
        name: "tags",
        path: ["tags"],
        optional: false,
        closedSet: null,
        free: ["string"],
        list: true,
      },
      {
        name: "count",
        path: ["count"],
        optional: false,
        closedSet: null,
        free: ["integer"],
      },
    ],
  });
  const options = (...tools: GoalLoopOperation[]): ToolOption[] =>
    tools.map((tool) => ({ key: tool.name, label: tool.description, tool }));
  const values: GoalValues = { "item name": "Milk", price: 2.5 };

  it("asks one question per free value the element tools share, and one per other operation's", () => {
    const questions = buildSpeculativeValueQuestions(
      options(typeTool, clickTool, fillTool, pomTool("List.add")),
      values
    );

    // type and fill share the question; the list, the optional note and the
    // integer no Goal Value fits are not asked.
    expect(
      questions.map(({ id, covers, instructions, options }) => ({
        id,
        covers,
        instructions,
        options: options.map((option) => option.key),
      }))
    ).toEqual([
      {
        id: "value:text",
        covers: [
          { operation: "type", parameter: "text" },
          { operation: "fill", parameter: "text" },
        ],
        instructions:
          'If the next operation is "type" or "fill" and enters text into one element of the page as its "text" parameter, which Goal Value is that text?',
        options: ["item name", NO_VALUE_NEEDED_KEY, NONE_OF_THESE_KEY],
      },
      {
        id: "value:List.add.name",
        covers: [{ operation: "List.add", parameter: "name" }],
        instructions:
          'If the next operation is "List.add" (Do List.add.), which Goal Value is its "name" (The item\'s name.) parameter?',
        options: ["item name", NO_VALUE_NEEDED_KEY, NONE_OF_THESE_KEY],
      },
    ]);
    expect(questions[0]!.options.at(-2)!.description).toBe(
      'No value needed: the next operation is not "type" or "fill".'
    );
  });

  it("asks nothing without Goal Values", () => {
    expect(
      buildSpeculativeValueQuestions(options(typeTool, pomTool("List.add")))
    ).toEqual([]);
  });

  it("leaves a parameter to stage two when its Goal Values fill a question", () => {
    const many = Object.fromEntries(
      Array.from({ length: 254 }, (_, index) => [`v${index}`, `V${index}`])
    );
    expect(buildSpeculativeValueQuestions(options(fillTool), many)).toEqual([]);
    const fitting = Object.fromEntries(Object.entries(many).slice(0, 253));
    expect(
      buildSpeculativeValueQuestions(options(fillTool), fitting)[0]?.options
    ).toHaveLength(255);
  });

  it("asks at most eight questions, in the order of the operations", () => {
    const tools = Array.from({ length: 10 }, (_, index) =>
      pomTool(`List.add${index}`)
    );

    const questions = buildSpeculativeValueQuestions(
      options(fillTool, ...tools),
      values
    );

    expect(questions.map((question) => question.id)).toEqual([
      "value:text",
      ...tools.slice(0, 7).map((tool) => `value:${tool.name}.name`),
    ]);
  });

  it("travels in the operation request next to the operation", () => {
    const toolOptions = options(fillTool);
    const request = buildOperationRequest(
      { goal: "g" },
      toolOptions,
      buildSpeculativeValueQuestions(toolOptions, values)
    );

    expect(Object.keys(request.questions)).toEqual([
      "operation",
      "goal_met",
      "value:text",
    ]);
    expect(request.questions["value:text"]).toMatchObject({
      type: "choice",
      criteria: { "item name": "item name: Milk" },
    });
  });

  it("tells the model how to read history in both stage-one questions", () => {
    const request = buildOperationRequest({ goal: "g" }, options(fillTool));

    expect(request.questions.operation).toMatchObject({
      instructions:
        'Which operation moves closest to the goal? `history` lists the steps already taken, newest last, each with what it changed on the page. A step that changed the page has taken effect; do not choose it again unless the goal needs it a second time. Choose the operation for the next thing the goal still needs; choose "none" when nothing fits.',
    });
    expect(request.questions.goal_met).toEqual({
      type: "noul",
      instructions:
        "Has the goal been fully achieved on the current page? Judge from `page` and `history`.",
    });
  });

  const speculativeOf = (...tools: GoalLoopOperation[]) =>
    buildSpeculativeValueQuestions(options(...tools), values);
  const choice = (key: string) => ({ type: "choice", choice: key });

  it("asks only single values of one kind: no lists, unions or objects", () => {
    const tool = {
      ...pomTool("List.add"),
      requiredParams: ["name", "tags", "either", "options"],
      args: [
        ...specsOfParameters([
          { name: "name", optional: false, schema: { type: "string" } },
          {
            name: "tags",
            optional: false,
            schema: { type: "array", items: { type: "string" } },
          },
          {
            name: "either",
            optional: false,
            schema: { anyOf: [{ type: "string" }, { type: "number" }] },
          },
          {
            name: "options",
            optional: false,
            schema: { type: "object", properties: {} },
          },
        ]),
      ],
    };

    expect(
      speculativeOf(tool).flatMap((question) =>
        question.covers.map((cover) => cover.parameter)
      )
    ).toEqual(["name"]);
  });

  it("reads only the answers that cover the chosen operation", () => {
    const questions = speculativeOf(fillTool, pomTool("List.add"));
    const record = { choices: {}, probabilities: {} };

    // The List.add answer is not one it offered, and is never read.
    const presets = readSpeculativeValues(
      fillTool,
      questions,
      {
        "value:text": {
          ...choice("item name"),
          probabilities: { "item name": 0.9 },
        },
        "value:List.add.name": choice("not offered"),
      },
      record
    );

    expect(presets).toEqual([
      {
        parameter: "text",
        path: ["text"],
        option: {
          key: "item name",
          description: "item name: Milk",
          value: "Milk",
        },
      },
    ]);
    expect(record).toEqual({
      choices: { "value:text": "item name" },
      probabilities: { "value:text": { "item name": 0.9 } },
    });
  });

  it.each([NO_VALUE_NEEDED_KEY, NONE_OF_THESE_KEY])(
    "leaves the parameter to stage two when the answer is %s",
    (key) => {
      const questions = speculativeOf(fillTool);
      const presets = readSpeculativeValues(
        fillTool,
        questions,
        { "value:text": choice(key) },
        { choices: {}, probabilities: {} }
      );

      expect(presets).toEqual([]);
      const plan = planArguments(
        fillTool,
        captureOfButtons(1),
        values,
        presets
      );
      if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
      expect(plan.questions.map((question) => question.id)).toEqual([
        "ref",
        "text",
      ]);
      expect(plan.questions[0]!.instructions).toMatch(
        /^Pick the element this operation acts on/
      );
    }
  );

  it("rejects an answer outside the options for the chosen operation", () => {
    expect(() =>
      readSpeculativeValues(
        fillTool,
        speculativeOf(fillTool),
        { "value:text": choice("Milk") },
        { choices: {}, probabilities: {} }
      )
    ).toThrow(/not one of the offered options/);
  });

  const presetsFor = (tool: GoalLoopOperation, key: string) =>
    readSpeculativeValues(
      tool,
      speculativeOf(tool),
      {
        [`value:${tool === fillTool ? "text" : `${tool.name}.name`}`]:
          choice(key),
      },
      { choices: {}, probabilities: {} }
    );

  it("asks stage two only for the element, naming the value it will receive", () => {
    const plan = planArguments(
      fillTool,
      captureOfButtons(2),
      values,
      presetsFor(fillTool, "item name")
    );

    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0]).toMatchObject({
      id: "ref",
      target: { receiving: 'the text "Milk" (the Goal Value "item name")' },
      instructions:
        'Pick the element that should receive the text "Milk" (the Goal Value "item name"), as this operation\'s "ref" parameter. The operation is "fill": fill text into one element. Choose "none_of_these" when the element is not among these.',
    });
  });

  it("names the value in every chunk and in the run-off", async () => {
    const presets = presetsFor(fillTool, "item name");
    const plan = planArguments(
      fillTool,
      captureOfButtons(300),
      values,
      presets
    );
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    const questions = plan.questions as ArgumentQuestion[];

    for (const question of questions)
      expect(question.instructions).toMatch(
        /^Pick the element that should receive the text "Milk" \(the Goal Value "item name"\), as this operation's "ref" parameter\. The page holds 300/
      );
    const answers = readArgumentAnswers(
      fillTool,
      questions,
      Object.fromEntries(
        questions.map((question) => [
          question.id,
          choice(question.options[0]!.key),
        ])
      )
    );
    if (answers.kind !== "run_off") throw new Error(answers.kind);
    expect(answers.question.instructions).toMatch(
      /Pick the one element that should receive the text "Milk" \(the Goal Value "item name"\), as this operation's "ref" parameter\./
    );
    expect(answers.question.target).toEqual({
      receiving: 'the text "Milk" (the Goal Value "item name")',
    });
  });

  it("completes the arguments with the preset, in the operation's order", () => {
    const tool: GoalLoopOperation = { ...fillTool, args: [textArg, refArg] };
    const plan = planArguments(
      tool,
      captureOfButtons(1),
      values,
      presetsFor(fillTool, "item name")
    );
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    const answers = readArgumentAnswers(tool, plan.questions, {
      ref: choice("e1"),
    });
    if (answers.kind !== "chosen") throw new Error(answers.kind);

    completeArguments(tool, answers.chosen, presetsFor(fillTool, "item name"));

    expect(answers.chosen.args).toEqual({ ref: "e1", text: "Milk" });
    expect(Object.entries(answers.chosen.chosen)).toEqual([
      ["text", { key: "item name", description: "item name: Milk" }],
      ["ref", { key: "e1", description: 'button "Item 1"' }],
    ]);
  });
});

describe("the state a request that only picks an element is sent", () => {
  /** Unnamed textboxes under named regions, with text around them. */
  function surveyCapture(): PageStateCapture {
    const yaml = [
      '- form "Survey editor" [ref=e1]:',
      '  - region "Question 1" [ref=e2]:',
      '    - heading "Basics" [level=3] [ref=e3]',
      "    - text: Question",
      "    - textbox [ref=e4]: Draft",
      "    - text: Description",
      '    - textbox "Optional" [ref=e5]:',
      "      - /placeholder: Optional",
      '  - region "Question 2" [ref=e6]:',
      '    - heading "Question 2" [level=3] [ref=e7]',
      "    - textbox [ref=e8]",
      '- button "Save" [ref=e9]',
    ].join("\n");
    const tree = StructuralTree.fromAriaSnapshotYaml(
      yaml,
      new SyntheticAriaRefFactory()
    );
    const elementsByRef = new Map<AriaRef, Element>();
    for (const ref of ["e4", "e5", "e8"])
      elementsByRef.set(
        AriaRefSchema.parse(ref),
        document.createElement("input")
      );
    elementsByRef.set(
      AriaRefSchema.parse("e9"),
      document.createElement("button")
    );
    return { tree, elementsByRef };
  }

  // A step that changed the page: its history entry carries what it changed.
  const history = [
    {
      operation: "check",
      chosen: { target: { key: "e7", description: 'checkbox "Required"' } },
      result: "ok",
      page_changed: true,
      changes: '- e7 <changed> checkbox "Required" [checked]',
      did: 'check(checkbox "Required")',
    },
  ];
  const state = {
    goal: "g",
    values: { name: "Milk" },
    page: ["the page"],
    page_objects: "",
    history,
  };
  const inputsOnly = {
    ...refArg,
    closedSet: {
      kind: "ref",
      filter: (element: Element) => element instanceof HTMLInputElement,
    },
  } as const;

  it("carries the candidates, each with where it sits and the text around it, instead of the page", () => {
    const capture = surveyCapture();
    const tool: GoalLoopOperation = { ...clickTool, args: [inputsOnly] };
    const plan = planArguments(tool, capture);
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);

    const request = buildArgumentRequest(state, plan.questions, capture);

    expect(request.state).toEqual({
      goal: "g",
      values: { name: "Milk" },
      history,
      elements: [
        {
          ref: "e4",
          role: "textbox",
          name: "",
          within: ['form "Survey editor"', 'region "Question 1"'],
          heading: "Basics",
          preceding_text: "Question",
          text: "Draft",
        },
        {
          ref: "e5",
          role: "textbox",
          name: "Optional",
          within: ['form "Survey editor"', 'region "Question 1"'],
          heading: "Basics",
          preceding_text: "Description",
          props: { placeholder: "Optional" },
        },
        // The heading names the region it is in, so only the region is listed.
        {
          ref: "e8",
          role: "textbox",
          name: "",
          within: ['form "Survey editor"', 'region "Question 2"'],
        },
      ],
    });
    expect(
      (request.questions as Record<string, { instructions: string }>).ref!
        .instructions
    ).toMatch(/Each option is an element of `elements` in the state/);
  });

  it("keeps the page when the request asks anything besides the element", () => {
    const capture = surveyCapture();
    const plan = planArguments(clickWithForceTool, capture);
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);

    const request = buildArgumentRequest(state, plan.questions, capture);

    expect(request.state).toBe(state);
    expect(
      (request.questions as Record<string, { instructions: string }>).ref!
        .instructions
    ).not.toMatch(/`elements`/);
  });
});
