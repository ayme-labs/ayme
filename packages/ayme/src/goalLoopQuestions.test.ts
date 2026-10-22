// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { PageStateCapture } from "./pageState";
import {
  chunkQuestionId,
  fitListsToTarget,
  listValueQuestionId,
  planArguments,
  readArgumentAnswers,
  readRunOffAnswer,
} from "./goalLoopQuestions";
import type { GoalLoopOperation } from "./goalLoopOperations";
import {
  captureOfButtons,
  choice,
  clickTool,
  noul,
  refArg,
} from "./stepDecision.testSupport";

/**
 * The two seams of the questions that `decideStep` cannot reach on its own
 * terms: reading a run-off answer the decision function got wrong, and fitting
 * a list to the element it is sent to. Everything else is tested through
 * `decideStep` (`stepDecision.test.ts`, `stepDecision.arguments.test.ts`).
 */

describe("readRunOffAnswer", () => {
  it("rejects a run-off answer outside the elements it offered", () => {
    const capture = captureOfButtons(600);
    const plan = planArguments(clickTool, capture);
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    const named: Record<string, string> = {
      [chunkQuestionId("ref", 1, ["ref"])]: "e10",
      [chunkQuestionId("ref", 2, ["ref"])]: "e300",
    };
    const answers = readArgumentAnswers(
      clickTool,
      plan.questions,
      Object.fromEntries(
        plan.questions.map((question) => [
          question.id,
          choice(named[question.id] ?? "none_of_these"),
        ])
      )
    );
    if (answers.kind !== "run_off") throw new Error(answers.kind);

    expect(() =>
      readRunOffAnswer(answers, {
        [answers.question.id]: { type: "choice", choice: "e20" },
      })
    ).toThrow(/not one of the offered options/);
  });
});

describe("fitListsToTarget", () => {
  /** An operation that sends a list of Goal Values to the element it acts on. */
  const selectTool: GoalLoopOperation = {
    name: "select_option",
    description: "Select options in a select element.",
    execute: async () => null,
    requiredParams: ["ref", "values"],
    args: [
      refArg,
      {
        name: "values",
        path: ["values"],
        optional: false,
        closedSet: null,
        free: ["string"],
        list: true,
      },
    ],
  };

  /** A page whose one element, e1, is `element`. */
  function captureOf(element: Element): PageStateCapture {
    const tree = StructuralTree.fromAriaSnapshotYaml(
      '- combobox "Size" [ref=e1]',
      new SyntheticAriaRefFactory()
    );
    const elementsByRef = new Map<AriaRef, Element>([
      [AriaRefSchema.parse("e1"), element],
    ]);
    return { tree, elementsByRef };
  }

  /**
   * The arguments once the model chose e1 and scored the Goal Values small,
   * medium and large with `scores`.
   */
  function chosenWith(capture: PageStateCapture, scores: readonly number[]) {
    const plan = planArguments(selectTool, capture, {
      small: "S",
      medium: "M",
      large: "L",
    });
    if (plan.kind !== "ask") throw new Error(`Unexpected plan ${plan.kind}`);
    const names = ["ref", "values"];
    const read = readArgumentAnswers(selectTool, plan.questions, {
      ref: choice("e1"),
      ...Object.fromEntries(
        scores.map((score, index) => [
          listValueQuestionId("values", index + 1, names),
          noul(score),
        ])
      ),
    });
    if (read.kind !== "chosen") throw new Error(read.kind);
    return read.chosen;
  }

  it("sends a select element only the Goal Value scored highest", () => {
    const capture = captureOf(document.createElement("select"));
    const chosen = chosenWith(capture, [0.6, 0.9, 0.7]);

    fitListsToTarget(selectTool, chosen, capture);

    expect(chosen.args).toEqual({ ref: "e1", values: ["M"] });
    expect(chosen.chosen.values).toEqual({
      key: "medium",
      description: "medium: M",
    });
  });

  it("keeps the first of the Goal Values scored highest on a tie", () => {
    const capture = captureOf(document.createElement("select"));
    const chosen = chosenWith(capture, [0.9, 0.6, 0.9]);

    fitListsToTarget(selectTool, chosen, capture);

    expect(chosen.args).toEqual({ ref: "e1", values: ["S"] });
  });

  it("sends a multiple select every Goal Value included", () => {
    const select = document.createElement("select");
    select.multiple = true;
    const capture = captureOf(select);
    const chosen = chosenWith(capture, [0.6, 0.9, 0.7]);

    fitListsToTarget(selectTool, chosen, capture);

    expect(chosen.args).toEqual({ ref: "e1", values: ["S", "M", "L"] });
    expect(chosen.chosen.values).toEqual({
      key: "small, medium, large",
      description: "small: S, medium: M, large: L",
    });
  });

  it("leaves the list alone for an element that is not a select", () => {
    const capture = captureOf(document.createElement("button"));
    const chosen = chosenWith(capture, [0.6, 0.9, 0.7]);

    fitListsToTarget(selectTool, chosen, capture);

    expect(chosen.args).toEqual({ ref: "e1", values: ["S", "M", "L"] });
  });
});
