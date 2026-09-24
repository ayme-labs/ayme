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

function askedQuestions(
  tool: ExecutableTool,
  capture: PageStateCapture
): ArgumentQuestion[] {
  const plan = planArguments(tool, capture);
  if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
  return plan.questions;
}

/** The option of a question that stands for no value ("none of these"). */
function noneOptionOf(question: ArgumentQuestion): string {
  const none = question.options.filter((option) => !("value" in option));
  expect(none).toHaveLength(1);
  return none[0]!.key;
}

/** The refs a question offers, in the order it offers them. */
function refsOf(question: ArgumentQuestion): string[] {
  return question.options.flatMap((option) =>
    "value" in option ? [String(option.value)] : []
  );
}

// --- Scripted decision function ---

/** What to answer per question id: an option key, or `none` for "none of these". */
type Script = Record<string, string | "none">;

/**
 * Answer a request from the script, with a probability of 1 on the chosen key
 * and 0 on the others, the way the decisions API scores a choice.
 */
function scriptedDecision(script: Script) {
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const questions = request.questions as Record<
      string,
      { criteria: Record<string, string> }
    >;
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(questions)) {
      const wanted = script[id];
      if (wanted === undefined) throw new Error(`No scripted answer for ${id}`);
      const keys = Object.keys(question.criteria);
      const choice = wanted === "none" ? keys[keys.length - 1]! : wanted;
      const probabilities: Record<string, number> = {};
      for (const key of keys) probabilities[key] = key === choice ? 1 : 0;
      answers[id] = { type: "choice", choice, probabilities };
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
  const response = await scriptedDecision(script)(request);
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

    // ⌈600 / 254⌉ = 3 chunks, all for the one parameter.
    expect(questions.map((question) => question.id)).toEqual([
      "ref_1",
      "ref_2",
      "ref_3",
    ]);
    expect(questions.every((question) => question.parameter === "ref")).toBe(
      true
    );
    for (const question of questions) {
      expect(refsOf(question).length).toBeLessThanOrEqual(254);
      expect(question.options.length).toBeLessThanOrEqual(255);
      // "None of these" is the last option of every chunk.
      expect(question.options[question.options.length - 1]!.key).toBe(
        noneOptionOf(question)
      );
      expect(question.instructions).toContain('"click_page_state_ref"');
    }
    // Together the chunks hold every option exactly once, in document order.
    expect(questions.flatMap(refsOf)).toEqual(
      Array.from({ length: 600 }, (_, index) => `e${index + 1}`)
    );
  });

  it("sends every chunk in the one stage-two request", () => {
    const capture = captureOfButtons(300);

    const request = buildArgumentRequest(
      { goal: "g" },
      askedQuestions(clickTool, capture)
    );

    expect(Object.keys(request.questions)).toEqual(["ref_1", "ref_2"]);
    const criteria = (request.questions as Record<string, { criteria: object }>)
      .ref_1!.criteria;
    expect(Object.keys(criteria).length).toBeLessThanOrEqual(255);
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
      optionCount: 0,
    });
  });

  it("acts on the one chunk that names an element", async () => {
    const { answers } = await askStageTwo(clickTool, captureOfButtons(600), {
      ref_1: "none",
      ref_2: "e300",
      ref_3: "none",
    });

    expect(answers.kind).toBe("chosen");
    if (answers.kind !== "chosen") return;
    expect(answers.chosen.args).toEqual({ ref: "e300" });
    expect(answers.chosen.summary).toEqual(['ref: button "Item 300"']);
    // Every chunk's answer is recorded.
    expect(Object.keys(answers.chosen.probabilities)).toEqual([
      "ref_1",
      "ref_2",
      "ref_3",
    ]);
  });

  it("asks a run-off among exactly the elements several chunks named", async () => {
    const { answers } = await askStageTwo(clickTool, captureOfButtons(600), {
      ref_1: "e10",
      ref_2: "e300",
      ref_3: "none",
    });

    expect(answers.kind).toBe("run_off");
    if (answers.kind !== "run_off") return;
    const { question } = answers;
    expect(question.id).toBe("ref_run_off");
    expect(question.parameter).toBe("ref");
    expect(question.path).toEqual(["ref"]);
    expect(refsOf(question)).toEqual(["e10", "e300"]);
    // The run-off offers no "none of these".
    expect(question.options.every((option) => "value" in option)).toBe(true);
    expect(question.instructions).toContain('"click_page_state_ref"');
    // It is one request with this one question.
    expect(Object.keys(buildArgumentRequest({}, [question]).questions)).toEqual(
      ["ref_run_off"]
    );

    const response = await scriptedDecision({ ref_run_off: "e300" })(
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
      "ref_1",
      "ref_2",
      "ref_3",
      "ref_run_off",
    ]);
    expect(chosen.probabilities.ref_run_off).toEqual({ e10: 0, e300: 1 });
  });

  it("rejects a run-off answer outside the elements it offered", async () => {
    const { answers } = await askStageTwo(clickTool, captureOfButtons(600), {
      ref_1: "e10",
      ref_2: "e300",
      ref_3: "none",
    });
    if (answers.kind !== "run_off") throw new Error(answers.kind);

    expect(() =>
      readRunOffAnswer(answers, {
        ref_run_off: { type: "choice", choice: "e20" },
      })
    ).toThrow(/not one of the offered options/);
  });

  it("reports that no element fits when every chunk answers none of these", async () => {
    const { answers } = await askStageTwo(clickTool, captureOfButtons(600), {
      ref_1: "none",
      ref_2: "none",
      ref_3: "none",
    });

    expect(answers.kind).toBe("none_fits");
    if (answers.kind !== "none_fits") return;
    expect(answers.parameter).toBe("ref");
    expect(Object.keys(answers.probabilities)).toEqual([
      "ref_1",
      "ref_2",
      "ref_3",
    ]);
  });

  it("asks the operation's other parameters alongside the chunks", async () => {
    const { request, answers } = await askStageTwo(
      clickWithForceTool,
      captureOfButtons(300),
      { ref_1: "e5", ref_2: "e299", force: "true" }
    );

    expect(Object.keys(request.questions)).toEqual(["ref_1", "ref_2", "force"]);
    expect(answers.kind).toBe("run_off");
    if (answers.kind !== "run_off") return;
    // The other parameter is already chosen; the run-off adds the ref.
    expect(answers.chosen.args).toEqual({ force: true });

    const chosen = readRunOffAnswer(answers, {
      ref_run_off: { type: "choice", choice: "e5" },
    });
    expect(chosen.args).toEqual({ force: true, ref: "e5" });
    expect(chosen.summary).toEqual(["force: true", 'ref: button "Item 5"']);
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
