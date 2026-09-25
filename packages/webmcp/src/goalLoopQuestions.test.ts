// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import type { PageStateCapture } from "./pageState";
import {
  NONE_OF_THESE_KEY,
  buildArgumentRequest,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
  type ArgumentQuestion,
  type ExecutableTool,
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
  return { tree, elementsByRef, reconcile: null };
}

const refArg = {
  name: "ref",
  path: ["ref"],
  optional: false,
  closedSet: { kind: "ref", filter: () => true },
} as const;

const clickTool: ExecutableTool = {
  name: "click_page_state_ref",
  description: "Click an element.",
  execute: async () => null,
  requiredParams: ["ref"],
  args: [refArg],
};

/** A Ref Tool with a boolean parameter next to its ref. */
const clickWithForceTool: ExecutableTool = {
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
 * A Ref Tool whose other closed-set parameters are named like the first chunk
 * and the run-off of its `ref` would be under a naive `<parameter>_<suffix>`.
 */
const clickWithLookalikeParametersTool: ExecutableTool = {
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
  tool: ExecutableTool,
  capture: PageStateCapture
): ArgumentQuestion[] {
  const plan = planArguments(tool, capture);
  if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
  return plan.questions;
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
    return { model: request.model, answers };
  };
}

/** Plan, ask, and read the stage-two answers for a tool on a capture. */
async function askStageTwo(
  tool: ExecutableTool,
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
      expect(question.instructions).toContain('"click_page_state_ref"');
    }
    // Together the chunks hold every option exactly once, in document order.
    expect(questions.flatMap(refsOf)).toEqual(
      Array.from({ length: 600 }, (_, index) => `e${index + 1}`)
    );
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
    expect(answers.chosen.summary).toEqual(['ref: button "Item 300"']);
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
    expect(question.instructions).toContain('"click_page_state_ref"');

    const response = await scriptedDecision([question], { ref: "e300" })(
      buildArgumentRequest({}, [question])
    );
    const chosen = readRunOffAnswer(
      answers,
      response.answers as Record<string, unknown>
    );
    expect(chosen.args).toEqual({ ref: "e300" });
    expect(chosen.summary).toEqual(['ref: button "Item 300"']);
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
    expect(chosen.summary).toEqual(
      expect.arrayContaining(["force: true", 'ref: button "Item 5"'])
    );
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
    }));
    const tool: ExecutableTool = {
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
