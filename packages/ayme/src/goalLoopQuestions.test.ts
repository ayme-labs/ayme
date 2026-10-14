// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { DecisionRequest, DecisionResponse } from "./decisionWire";
import type { PageStateCapture } from "./pageState";
import {
  NONE_OF_THESE_KEY,
  NO_VALUE_NEEDED_KEY,
  addValuePresets,
  buildArgumentRequest,
  buildOperationRequest,
  buildSpeculativeValueQuestions,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  readSpeculativeValues,
  type ArgumentQuestion,
  type GoalLoopOperation,
  type GoalValues,
  type ToolOption,
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
        free: "string_list",
      },
      {
        name: "labels_1",
        path: ["labels_1"],
        optional: true,
        closedSet: null,
        free: "integer",
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

describe("Goal Values asked speculatively in stage one", () => {
  const textArg = {
    name: "text",
    path: ["text"],
    optional: false,
    closedSet: null,
    free: "string",
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
        free: "string",
        description: "The item's name.",
      },
      {
        name: "note",
        path: ["note"],
        optional: true,
        closedSet: null,
        free: "string",
      },
      {
        name: "tags",
        path: ["tags"],
        optional: false,
        closedSet: null,
        free: "string_list",
      },
      {
        name: "count",
        path: ["count"],
        optional: false,
        closedSet: null,
        free: "integer",
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
        'Pick the element that should receive the text "Milk" (the Goal Value "item name"), as this operation\'s "ref" parameter. The operation is "fill": fill text into one element.',
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

    addValuePresets(tool, answers.chosen, presetsFor(fillTool, "item name"));

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
