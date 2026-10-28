// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { GoalLoopStepRecord, GoalValues, JsonSchema } from "../../shared";
import type { DecisionRequest } from "../domain/decisionWire";
import type { PageCapture } from "../../page-state/domain";
import { alwaysReaches } from "../../test-utils/reach.testSupport";
import {
  NONE_OF_THESE_KEY,
  NO_VALUE_NEEDED_KEY,
} from "../domain/goalLoopQuestions";
import {
  specsOfParameters,
  type GoalLoopOperation,
} from "../domain/goalLoopOperations";
import {
  actionWith,
  archiveTool,
  captureOfButtons,
  choice,
  clickTool,
  criteriaKeys,
  forceClickTool,
  noul,
  optionOf,
  questionsOf,
  refArg,
  scripted,
  stageOne,
  stageOneWithValues,
  step,
  type Turn,
} from "../test-utils/stepDecision.testSupport";

/**
 * The arguments a Step Decision runs its operation with: asked in stage two
 * from the closed sets and the Goal Values, asked in stage one for a free
 * value, and completed into the operation's input shape.
 */

/**
 * Decide a step that chooses `tool`, with any Goal Value stage one asks about
 * left to stage two, and stage two answered by `turns`.
 */
async function decideOn(
  tool: GoalLoopOperation,
  values: GoalValues | undefined,
  ...turns: Turn[]
) {
  const { decide, requests } = scripted(
    stageOneWithValues(tool.name),
    ...turns
  );
  const verdict = await step(decide, {
    toolOptions: [optionOf(tool)],
    values,
  });
  return { verdict, requests };
}

/** The verdict's arguments, or the verdict itself when it did not act. */
const argsOf = (verdict: Awaited<ReturnType<typeof step>>) =>
  verdict.kind === "act" ? verdict.args : verdict;

/** Answer every question of the request with a noul, in the order asked. */
const nouls =
  (...scores: number[]) =>
  (request: DecisionRequest): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(request.questions).map((id, index) => [
        id,
        noul(scores[index]!),
      ])
    );

/** Answer every question of the request with a choice, in the order asked. */
const choices =
  (...keys: string[]) =>
  (request: DecisionRequest): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(request.questions).map((id, index) => [
        id,
        choice(keys[index]!),
      ])
    );

describe("rooted instance choices", () => {
  it("describes unnamed roots with their visible item text", async () => {
    const tree = StructuralTree.fromAriaSnapshotYaml(
      `- list "Active items":
  - listitem [ref=e1]:
    - button "Draft release notes" [ref=e2]
    - button "Archive" [ref=e3]
  - listitem [ref=e4]:
    - button "Review onboarding flow" [ref=e5]
    - button "Archive" [ref=e6]`,
      new SyntheticAriaRefFactory()
    );
    const elementsByRef = new Map<AriaRef, Element>(
      ["e1", "e4"].map((ref) => [
        AriaRefSchema.parse(ref),
        document.createElement("li"),
      ])
    );
    const tool = archiveTool(
      [...elementsByRef.values()].map((element) => ({
        element,
        present: true,
        available: true,
      }))
    );
    const { decide, requests } = scripted(stageOne(tool.name), {
      answers: { ref: choice("e4") },
    });

    const verdict = await step(decide, {
      goal: "Archive the second item in the list",
      capture: { tree, elementsByRef, pomRootMarks: new Map() },
      toolOptions: [optionOf(tool)],
    });

    expect(questionsOf(requests[1]).ref!.criteria).toMatchObject({
      e1: 'List on ref "e1" (listitem): Draft release notes · Archive',
      e4: 'List on ref "e4" (listitem): Review onboarding flow · Archive',
    });
    expect(verdict).toMatchObject({ kind: "act", args: { ref: "e4" } });
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

  it("asks one noul per string Goal Value of a list, with ids apart from every parameter", async () => {
    const { verdict, requests } = await decideOn(
      tagTool,
      { first: "urgent", count: 2, second: "billing" },
      {
        answers: {
          labels__1: noul(0.9),
          labels__2: noul(0.1),
          labels_1: choice("leave_unset"),
        },
      }
    );

    const questions = questionsOf(requests[1]);
    expect(Object.keys(questions)).toEqual([
      "labels__1",
      "labels__2",
      "labels_1",
    ]);
    expect(Object.values(questions).map((question) => question.type)).toEqual([
      "noul",
      "noul",
      "choice",
    ]);
    expect(argsOf(verdict)).toEqual({ labels: ["urgent"] });
  });

  it("keeps the list's included values in map order, and their scores", async () => {
    const { verdict } = await decideOn(
      tagTool,
      { first: "urgent", second: "billing", third: "spam" },
      {
        answers: {
          labels__1: noul(0.5),
          labels__2: noul(0.49),
          labels__3: noul(0.8),
        },
      }
    );

    expect(verdict).toMatchObject({
      kind: "act",
      chosen: {
        labels: {
          key: "first, third",
          description: "first: urgent, third: spam",
        },
      },
    });
    expect(argsOf(verdict)).toEqual({ labels: ["urgent", "spam"] });
    expect(verdict.scores?.argumentProbabilities).toEqual({
      labels__1: { first: 0.5 },
      labels__2: { second: 0.49 },
      labels__3: { third: 0.8 },
    });
  });

  it("keeps a list value labelled __proto__ through both requests and its answer", async () => {
    const values = JSON.parse('{ "__proto__": "urgent" }') as GoalValues;

    const { verdict, requests } = await decideOn(tagTool, values, {
      answers: { labels__1: noul(0.9) },
    });

    for (const request of requests)
      expect(Object.keys((request.state as { values: object }).values)).toEqual(
        ["__proto__"]
      );
    expect(Object.keys(requests[1]!.questions)).toEqual(["labels__1"]);
    expect(argsOf(verdict)).toEqual({ labels: ["urgent"] });
    expect(verdict.kind === "act" && verdict.chosen.labels).toEqual({
      key: "__proto__",
      description: "__proto__: urgent",
    });
    expect(
      Object.keys(verdict.scores!.argumentProbabilities!.labels__1!)
    ).toEqual(["__proto__"]);
  });

  it("hands a required parameter no Goal Value can fill to the calling agent", async () => {
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

    const { verdict, requests } = await decideOn(tool, { name: "Milk" });

    expect(verdict).toMatchObject({
      kind: "stop",
      reason: "needs_value",
      next: 'The operation "tag" needs values for: options, and no Goal Value fits options. Call goal again with a value for options in values, or call tag directly.',
      needs: { tool: "tag", parameters: ["options"] },
    });
    expect(requests).toHaveLength(1);
  });
});

describe("parameter shapes", () => {
  const enumList: JsonSchema = {
    type: "array",
    items: { type: "string", enum: ["low", "high"] },
  };
  const numberList: JsonSchema = { type: "array", items: { type: "number" } };
  /** [asc | desc, string], both slots required. */
  const sortTuple: JsonSchema = {
    type: "array",
    prefixItems: [
      { type: "string", enum: ["asc", "desc"] },
      { type: "string" },
    ],
    minItems: 2,
    maxItems: 2,
  };

  /** The stop a required parameter no Goal Value fits comes to. */
  const needsFreeValue = (unfilled = "param") => ({
    kind: "stop",
    reason: "needs_value",
    next: `The operation "act" needs values for: param, and no Goal Value fits ${unfilled}. Call goal again with a value for ${unfilled} in values, or call act directly.`,
    needs: { tool: "act", parameters: ["param"] },
  });

  it("asks one noul per enum value of an enum list, never a Goal Value", async () => {
    const { verdict, requests } = await decideOn(
      actionWith(enumList),
      { other: "urgent", extra: "low" },
      { answer: nouls(0.2, 0.9) }
    );

    const questions = Object.values(questionsOf(requests[1]));
    expect(questions.map((question) => question.type)).toEqual([
      "noul",
      "noul",
    ]);
    expect(questions[0]!.instructions).toContain('Does the value "low"');
    expect(questions[1]!.instructions).toContain('Does the value "high"');
    expect(argsOf(verdict)).toEqual({ param: ["high"] });
    expect(
      Object.values(verdict.scores!.argumentProbabilities!).map(Object.keys)
    ).toEqual([["low"], ["high"]]);
  });

  it("says no Goal Value was offered when nothing belongs in a required enum list", async () => {
    const { verdict } = await decideOn(
      actionWith(enumList),
      { other: "urgent" },
      { answer: nouls(0.1, 0.2) }
    );

    expect(verdict).toEqual({
      kind: "stop",
      reason: "needs_value",
      next: 'The operation "act" needs a value for "param", and the model judged that none of its allowed values belongs in it.',
      needs: { tool: "act", parameters: ["param"] },
      scores: expect.anything(),
    });
  });

  it("says Goal Values were offered when none belongs in a required number list", async () => {
    const { verdict } = await decideOn(
      actionWith(numberList),
      { quantity: 2 },
      { answer: nouls(0.1) }
    );

    expect(verdict).toMatchObject({
      kind: "stop",
      reason: "needs_value",
      next: 'The operation "act" needs a value for "param", and the model judged that none of the Goal Values fits. Call goal again with a value for "param" in values, or call act directly.',
      needs: { tool: "act", parameters: ["param"] },
    });
  });

  it("asks about an enum list without any Goal Values", async () => {
    const { verdict, requests } = await decideOn(
      actionWith(enumList),
      {},
      { answer: nouls(0.9, 0.9) }
    );

    expect(Object.keys(requests[1]!.questions)).toHaveLength(2);
    expect(argsOf(verdict)).toEqual({ param: ["low", "high"] });
  });

  it("fills a number list from the numeric Goal Values, one noul each", async () => {
    const { verdict, requests } = await decideOn(
      actionWith(numberList),
      { name: "Milk", quantity: 2, price: 1.5 },
      { answer: nouls(0.9, 0.7) }
    );

    const questions = Object.values(questionsOf(requests[1]));
    expect(questions).toHaveLength(2);
    expect(questions[0]!.instructions).toContain(
      'Does the Goal Value "quantity: 2"'
    );
    expect(questions[1]!.instructions).toContain(
      'Does the Goal Value "price: 1.5"'
    );
    expect(argsOf(verdict)).toEqual({ param: [2, 1.5] });
    expect(
      Object.values(verdict.scores!.argumentProbabilities!).map(Object.keys)
    ).toEqual([["quantity"], ["price"]]);
  });

  it("offers an integer list only the whole-number Goal Values", async () => {
    const { verdict, requests } = await decideOn(
      actionWith({ type: "array", items: { type: "integer" } }),
      { quantity: 2, price: 1.5 },
      { answer: nouls(0.9) }
    );

    const questions = Object.values(questionsOf(requests[1]));
    expect(questions).toHaveLength(1);
    expect(questions[0]!.instructions).toContain('"quantity: 2"');
    expect(argsOf(verdict)).toEqual({ param: [2] });
  });

  it("hands a required number list over when no numeric Goal Value fits", async () => {
    const { verdict, requests } = await decideOn(actionWith(numberList), {
      name: "Milk",
    });

    expect(verdict).toMatchObject(needsFreeValue());
    expect(requests).toHaveLength(1);
  });

  it("fills a tuple slot by slot: the enum slot by choice, the string slot from a Goal Value", async () => {
    const tool = actionWith(sortTuple);
    expect(tool.args.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: "param.0", path: ["param", 0] },
      { name: "param.1", path: ["param", 1] },
    ]);

    const { verdict, requests } = await decideOn(
      tool,
      { column: "price", count: 3 },
      { answer: choices("desc", "column") }
    );

    expect(Object.keys(requests[1]!.questions)).toEqual(["param.0", "param.1"]);
    expect(criteriaKeys(requests[1], "param.0")).toEqual(["asc", "desc"]);
    expect(criteriaKeys(requests[1], "param.1")).toEqual([
      "column",
      NONE_OF_THESE_KEY,
    ]);
    expect(argsOf(verdict)).toEqual({ param: ["desc", "price"] });
    expect(Array.isArray((argsOf(verdict) as { param: unknown }).param)).toBe(
      true
    );
  });

  it("hands a required tuple over when no Goal Value fits a slot, naming the tuple", async () => {
    const { verdict } = await decideOn(
      actionWith({
        type: "array",
        prefixItems: [{ type: "boolean" }, { type: "string" }],
        minItems: 2,
        maxItems: 2,
      }),
      { count: 3 }
    );

    expect(verdict).toMatchObject(needsFreeValue());
  });

  it("names the whole tuple when the model finds no Goal Value for a slot", async () => {
    const { verdict } = await decideOn(
      actionWith(sortTuple),
      { column: "price" },
      { answer: choices("asc", NONE_OF_THESE_KEY) }
    );

    expect(verdict).toMatchObject({
      kind: "stop",
      reason: "needs_value",
      next: 'The operation "act" needs a value for "param", and the model judged that none of the Goal Values fits. Call goal again with a value for "param" in values, or call act directly.',
      needs: { tool: "act", parameters: ["param"] },
    });
  });

  it("names a tuple inside an object by its whole path", async () => {
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

    const { verdict } = await decideOn(tool, {});

    expect(verdict).toMatchObject(needsFreeValue("args.coords"));
  });

  it("passes a required tuple with no slot set as an empty tuple, without asking stage two", async () => {
    const { verdict, requests } = await decideOn(
      actionWith({
        type: "array",
        prefixItems: [{ type: "string" }],
        maxItems: 1,
      }),
      { count: 3 }
    );

    expect(verdict).toMatchObject({ kind: "act", chosen: {} });
    expect(argsOf(verdict)).toEqual({ param: [] });
    expect(requests).toHaveLength(1);
  });

  it("leaves an optional tuple out when a slot it requires stays unset", async () => {
    const { verdict, requests } = await decideOn(
      actionWith(sortTuple, true),
      { column: "price" },
      { answer: choices("asc", "leave_unset") }
    );

    // An optional slot may be left unset.
    expect(criteriaKeys(requests[1], "param.0")).toEqual([
      "asc",
      "desc",
      "leave_unset",
    ]);
    expect(criteriaKeys(requests[1], "param.1")).toEqual([
      "column",
      "leave_unset",
    ]);
    expect(argsOf(verdict)).toEqual({});
    expect(verdict.kind === "act" && verdict.chosen).toEqual({});
  });

  it("leaves an optional tuple out when every slot stays unset", async () => {
    const { verdict } = await decideOn(
      actionWith(
        {
          type: "array",
          prefixItems: [{ type: "string", enum: ["asc", "desc"] }],
          minItems: 1,
          maxItems: 1,
        },
        true
      ),
      {},
      { answer: choices("leave_unset") }
    );

    expect(argsOf(verdict)).toEqual({});
  });

  const twoBooleans: JsonSchema = {
    type: "array",
    prefixItems: [{ type: "boolean" }, { type: "boolean" }],
    maxItems: 2,
  };

  it("leaves out an optional tuple that ends up empty, like one with nothing set", async () => {
    const { verdict } = await decideOn(
      actionWith(twoBooleans, true),
      {},
      { answer: choices("leave_unset", "true") }
    );

    expect(argsOf(verdict)).toEqual({});
  });

  it("keeps an optional tuple with a slot set, and a required one cut to empty", async () => {
    const optional = await decideOn(
      actionWith(twoBooleans, true),
      {},
      { answer: choices("true", "leave_unset") }
    );
    const required = await decideOn(
      actionWith(twoBooleans),
      {},
      { answer: choices("leave_unset", "true") }
    );

    expect(argsOf(optional.verdict)).toEqual({ param: [true] });
    expect(argsOf(required.verdict)).toEqual({ param: [] });
  });

  it("completes nested tuples innermost first", async () => {
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

    const innerCut = await decideOn(
      tool,
      { name: "Milk" },
      { answer: choices("name", "leave_unset", "a") }
    );
    const nothingSet = await decideOn(
      tool,
      { name: "Milk" },
      { answer: choices("leave_unset", "leave_unset", "leave_unset") }
    );

    expect(argsOf(innerCut.verdict)).toEqual({});
    expect(argsOf(nothingSet.verdict)).toEqual({});
  });

  it("ends a tuple at its first unset optional slot", async () => {
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

    const { verdict } = await decideOn(
      tool,
      { name: "Milk" },
      { answer: choices("name", "leave_unset", "true") }
    );
    const again = await decideOn(
      tool,
      { name: "Milk" },
      { answer: choices("name", "leave_unset", "leave_unset") }
    );

    expect(argsOf(verdict)).toEqual({ param: ["Milk"] });
    // The step record shows what runs, so a repeat reads as one.
    expect(verdict.kind === "act" && Object.keys(verdict.chosen)).toEqual([
      "param.0",
    ]);
    expect(again.verdict.kind === "act" && again.verdict.chosen).toEqual(
      verdict.kind === "act" && verdict.chosen
    );
  });

  it("names the whole tuple when a slot's enum is too large to ask", async () => {
    const { verdict } = await decideOn(
      actionWith({
        type: "array",
        prefixItems: [
          {
            type: "string",
            enum: Array.from({ length: 256 }, (_, index) => `v${index}`),
          },
        ],
        minItems: 1,
        maxItems: 1,
      }),
      {}
    );

    expect(verdict).toMatchObject({
      kind: "stop",
      reason: "needs_value",
      next: 'The operation "act" needs a value for "param", and its 256 allowed values are not a choice one decision can answer. Provide the value and call the operation directly, or try a different approach.',
      needs: { tool: "act", parameters: ["param"] },
    });
  });

  it("keeps enum list values that print alike apart", async () => {
    const { verdict, requests } = await decideOn(
      actionWith({
        type: "array",
        items: {
          anyOf: [
            { type: "number", enum: [1] },
            { type: "string", enum: ["1"] },
          ],
        },
      }),
      {},
      { answer: nouls(0.9, 0.9) }
    );

    expect(Object.keys(requests[1]!.questions)).toHaveLength(2);
    expect(verdict.kind === "act" && verdict.chosen.param!.key).toBe(
      "1, 1 (2)"
    );
    expect(argsOf(verdict)).toEqual({ param: [1, "1"] });
    expect(
      Object.values(verdict.scores!.argumentProbabilities!).map(Object.keys)
    ).toEqual([["1"], ["1 (2)"]]);
  });

  it("keeps a tuple whose slots the two stages filled between them", async () => {
    const { decide, requests } = scripted(
      stageOneWithValues("act", { "value:act.param.1": "column" }),
      { answers: { "param.0": choice("desc") } }
    );

    const verdict = await step(decide, {
      toolOptions: [optionOf(actionWith(sortTuple))],
      values: { column: "price" },
    });

    // Stage one chose the string slot, so stage two asks only the enum slot.
    expect(Object.keys(requests[1]!.questions)).toEqual(["param.0"]);
    expect(verdict.scores?.valueChoices).toEqual({
      "value:act.param.1": "column",
    });
    expect(argsOf(verdict)).toEqual({ param: ["desc", "price"] });
  });

  /** A string the model may also answer with true or false. */
  const stringOrBoolean: JsonSchema = {
    anyOf: [{ type: "string" }, { type: "boolean" }],
  };

  it("offers a union of primitives its booleans and the fitting string Goal Values in one question", async () => {
    const values = { name: "Milk", count: 2 };
    const { verdict, requests } = await decideOn(
      actionWith(stringOrBoolean),
      values,
      { answer: choices("name") }
    );
    const asBoolean = await decideOn(actionWith(stringOrBoolean), values, {
      answer: choices("true"),
    });

    expect(Object.keys(requests[1]!.questions)).toEqual(["param"]);
    expect(questionsOf(requests[1]).param!.instructions).toMatch(
      /^Pick the value or Goal Value /
    );
    expect(criteriaKeys(requests[1], "param")).toEqual([
      "true",
      "false",
      "name",
    ]);
    expect(argsOf(verdict)).toEqual({ param: "Milk" });
    expect(argsOf(asBoolean.verdict)).toEqual({ param: true });
  });

  it("offers a union of string and number every Goal Value of either type", async () => {
    const { verdict, requests } = await decideOn(
      actionWith({ anyOf: [{ type: "string" }, { type: "number" }] }),
      { name: "Milk", count: 2 },
      { answer: choices("count") }
    );

    expect(criteriaKeys(requests[1], "param")).toEqual([
      "name",
      "count",
      NONE_OF_THESE_KEY,
    ]);
    expect(argsOf(verdict)).toEqual({ param: 2 });
  });

  it("offers null as the closed value of a nullable union", async () => {
    const { verdict, requests } = await decideOn(
      actionWith({ anyOf: [{ type: "string" }, { type: "null" }] }),
      { name: "Milk" },
      { answer: choices("null") }
    );

    expect(criteriaKeys(requests[1], "param")).toEqual(["null", "name"]);
    expect(argsOf(verdict)).toEqual({ param: null });
  });

  it("hands over a required union with a variant that is not a primitive", async () => {
    const { verdict } = await decideOn(
      actionWith({
        anyOf: [
          { type: "string" },
          { type: "object", properties: {}, additionalProperties: false },
        ],
      }),
      { name: "Milk" }
    );

    expect(verdict).toMatchObject(needsFreeValue());
  });

  it("keeps a Goal Value labelled like a boolean apart from the boolean", async () => {
    const { verdict, requests } = await decideOn(
      actionWith(stringOrBoolean),
      { true: "yes" },
      { answer: choices("true (2)") }
    );

    expect(criteriaKeys(requests[1], "param")).toEqual([
      "true",
      "false",
      "true (2)",
    ]);
    expect(argsOf(verdict)).toEqual({ param: "yes" });
  });

  it.each<[string, JsonSchema]>([
    ["a map", { type: "object", additionalProperties: { type: "string" } }],
    ["a list of booleans", { type: "array", items: { type: "boolean" } }],
    [
      "a list of objects",
      {
        type: "array",
        items: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    [
      "a list of lists",
      { type: "array", items: { type: "array", items: { type: "string" } } },
    ],
  ])(
    "hands %s over when required and leaves it out when optional",
    async (_, schema) => {
      const values = { name: "Milk", count: 2 };

      const required = await decideOn(actionWith(schema), values);
      const optional = await decideOn(actionWith(schema, true), values);

      expect(required.verdict).toMatchObject(needsFreeValue());
      expect(optional.verdict).toMatchObject({ kind: "act" });
      expect(argsOf(optional.verdict)).toEqual({});
      expect(optional.requests).toHaveLength(1);
    }
  );

  it("keeps string lists filled from string Goal Values only", async () => {
    const { verdict, requests } = await decideOn(
      actionWith({ type: "array", items: { type: "string" } }),
      { name: "Milk", count: 2 },
      { answer: nouls(0.9) }
    );

    const questions = Object.values(questionsOf(requests[1]));
    expect(questions).toHaveLength(1);
    expect(questions[0]!.instructions).toContain(
      'Does the Goal Value "name: Milk"'
    );
    expect(argsOf(verdict)).toEqual({ param: ["Milk"] });
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
  const values: GoalValues = { "item name": "Milk", price: 2.5 };
  const stageOneIds = ["operation", "goal_met", "goal_remaining"];

  /**
   * The stage-one request a step offering `tools` sends, with `goalValues`,
   * when the model then chooses none.
   */
  async function stageOneRequest(
    tools: GoalLoopOperation[],
    goalValues: GoalValues | undefined
  ) {
    const { decide, requests } = scripted(stageOne("none"));
    await step(decide, {
      toolOptions: tools.map(optionOf),
      values: goalValues,
    });
    return requests[0]!;
  }

  it("asks one question per free value the element tools share, and one per other operation's", async () => {
    const request = await stageOneRequest(
      [typeTool, clickTool, fillTool, pomTool("List.add")],
      values
    );

    // type and fill share the question; the list, the optional note and the
    // integer no Goal Value fits are not asked.
    expect(Object.keys(request.questions)).toEqual([
      ...stageOneIds,
      "value:text",
      "value:List.add.name",
    ]);
    expect(questionsOf(request)["value:text"]).toEqual({
      type: "choice",
      instructions:
        'If the next operation is "type" or "fill" and enters text into one element of the page as its "text" parameter, which Goal Value is that text?',
      criteria: {
        "item name": "item name: Milk",
        [NO_VALUE_NEEDED_KEY]:
          'No value needed: the next operation is not "type" or "fill".',
        [NONE_OF_THESE_KEY]: "None of these Goal Values is the text to enter.",
      },
    });
    expect(questionsOf(request)["value:List.add.name"]).toEqual({
      type: "choice",
      instructions:
        'If the next operation is "List.add" (Do List.add.), which Goal Value is its "name" (The item\'s name.) parameter?',
      criteria: {
        "item name": "item name: Milk",
        [NO_VALUE_NEEDED_KEY]:
          'No value needed: the next operation is not "List.add".',
        [NONE_OF_THESE_KEY]:
          'None of these Goal Values is the "name" value to enter.',
      },
    });
    for (const id of ["value:text", "value:List.add.name"])
      expect(criteriaKeys(request, id)).toEqual([
        "item name",
        NO_VALUE_NEEDED_KEY,
        NONE_OF_THESE_KEY,
      ]);
  });

  it("asks nothing without Goal Values", async () => {
    const request = await stageOneRequest(
      [typeTool, pomTool("List.add")],
      undefined
    );

    expect(Object.keys(request.questions)).toEqual(stageOneIds);
  });

  it("leaves a parameter to stage two when its Goal Values fill a question", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 254 }, (_, index) => [`v${index}`, `V${index}`])
    );
    const fitting = Object.fromEntries(Object.entries(many).slice(0, 253));

    const full = await stageOneRequest([fillTool], many);
    const roomy = await stageOneRequest([fillTool], fitting);

    expect(Object.keys(full.questions)).toEqual(stageOneIds);
    expect(criteriaKeys(roomy, "value:text")).toHaveLength(255);
  });

  it("asks at most eight questions, in the order of the operations", async () => {
    const tools = Array.from({ length: 10 }, (_, index) =>
      pomTool(`List.add${index}`)
    );

    const request = await stageOneRequest([fillTool, ...tools], values);

    expect(Object.keys(request.questions)).toEqual([
      ...stageOneIds,
      "value:text",
      ...tools.slice(0, 7).map((tool) => `value:${tool.name}.name`),
    ]);
  });

  it("travels in the operation request next to the operation", async () => {
    const request = await stageOneRequest([fillTool], values);

    expect(Object.keys(request.questions)).toEqual([
      ...stageOneIds,
      "value:text",
    ]);
    expect(request.questions["value:text"]).toMatchObject({
      type: "choice",
      criteria: { "item name": "item name: Milk" },
    });
  });

  it("tells the model how to read history in both stage-one questions", async () => {
    const request = await stageOneRequest([fillTool], values);

    expect(request.questions.operation).toMatchObject({
      instructions:
        'Which operation moves closest to the goal? `history` lists the steps already taken, newest last, each with what it changed on the page. A step that changed the page has taken effect; do not choose it again unless the goal needs it a second time. Choose the operation for the next thing the goal still needs; choose "none" when nothing fits.',
    });
    expect(request.questions.goal_met).toEqual({
      type: "noul",
      instructions:
        "Has the goal been fully achieved on the current page? Judge from `page` and `history`.",
    });
    expect(request.questions.goal_remaining).toEqual({
      type: "noul",
      instructions:
        "Does the goal still need a step that has not run yet? Judge from `history` and `page`.",
    });
  });

  it("asks only single values of one kind: no lists, unions or objects", async () => {
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

    const request = await stageOneRequest([tool], values);

    expect(Object.keys(request.questions)).toEqual([
      ...stageOneIds,
      "value:List.add.name",
    ]);
  });

  it.each([typeTool, fillTool])(
    "reads only the answers that cover the chosen operation: $name",
    async (chosenTool) => {
      // The List.add answer is not one it offered, and is never read.
      const { decide, requests } = scripted(
        {
          answers: {
            ...stageOne(chosenTool.name).answers,
            "value:text": {
              ...choice("item name"),
              probabilities: { "item name": 0.9 },
            },
            "value:List.add.name": choice("not offered"),
          },
        },
        { answers: { ref: choice("e1") } }
      );

      const verdict = await step(decide, {
        toolOptions: [typeTool, fillTool, pomTool("List.add")].map(optionOf),
        values,
      });

      expect(Object.keys(requests[0]!.questions)).toEqual([
        ...stageOneIds,
        "value:text",
        "value:List.add.name",
      ]);
      expect(Object.keys(requests[1]!.questions)).toEqual(["ref"]);
      expect(verdict).toMatchObject({
        kind: "act",
        operation: chosenTool,
        chosen: { text: { key: "item name", description: "item name: Milk" } },
      });
      expect(argsOf(verdict)).toEqual({ ref: "e1", text: "Milk" });
      expect(verdict.scores?.valueChoices).toEqual({
        "value:text": "item name",
      });
      expect(verdict.scores?.valueProbabilities).toEqual({
        "value:text": { "item name": 0.9 },
      });
    }
  );

  it.each([NO_VALUE_NEEDED_KEY, NONE_OF_THESE_KEY])(
    "leaves the parameter to stage two when the answer is %s",
    async (key) => {
      const { decide, requests } = scripted(
        stageOneWithValues("fill", { "value:text": key }),
        { answers: { ref: choice("e1"), text: choice("item name") } }
      );

      const verdict = await step(decide, {
        capture: captureOfButtons(1),
        toolOptions: [optionOf(fillTool)],
        values,
      });

      expect(verdict.scores?.valueChoices).toEqual({ "value:text": key });
      expect(Object.keys(requests[1]!.questions)).toEqual(["ref", "text"]);
      expect(questionsOf(requests[1]).ref!.instructions).toMatch(
        /^Pick the element this operation acts on/
      );
      expect(argsOf(verdict)).toEqual({ ref: "e1", text: "Milk" });
    }
  );

  /** Stage one choosing `fill`, with the Goal Value "item name" for its text. */
  const fillWithItemName = () =>
    stageOneWithValues("fill", { "value:text": "item name" });

  it("asks stage two only for the element, naming the value it will receive", async () => {
    const { decide, requests } = scripted(fillWithItemName(), {
      answers: { ref: choice("e2") },
    });

    const verdict = await step(decide, {
      capture: captureOfButtons(2),
      toolOptions: [optionOf(fillTool)],
      values,
    });

    expect(Object.keys(requests[1]!.questions)).toEqual(["ref"]);
    expect(questionsOf(requests[1]).ref!.instructions).toBe(
      'Pick the element that should receive the text "Milk" (the Goal Value "item name"), as this operation\'s "ref" parameter. The operation is "fill": fill text into one element. Each option is an element of `elements` in the state, matched by its `ref`: where it sits on the page and the text around it.'
    );
    expect(argsOf(verdict)).toEqual({ ref: "e2", text: "Milk" });
  });

  it("names the value in every chunk and in the run-off", async () => {
    const runOff = "ref_run_off";
    const { decide, requests } = scripted(
      fillWithItemName(),
      // Each chunk names its first element.
      {
        answer: (request) =>
          Object.fromEntries(
            Object.keys(request.questions).map((id) => [
              id,
              choice(criteriaKeys(request, id)[0]!),
            ])
          ),
      },
      { answers: { [runOff]: choice("e151") } }
    );

    const verdict = await step(decide, {
      capture: captureOfButtons(300),
      toolOptions: [optionOf(fillTool)],
      values,
    });

    const chunks = ["ref_1", "ref_2"];
    expect(Object.keys(requests[1]!.questions)).toEqual(chunks);
    for (const id of chunks)
      expect(questionsOf(requests[1])[id]!.instructions).toMatch(
        /^Pick the element that should receive the text "Milk" \(the Goal Value "item name"\), as this operation's "ref" parameter\. The page holds 300/
      );
    expect(questionsOf(requests[2])[runOff]!.instructions).toMatch(
      /Pick the one element that should receive the text "Milk" \(the Goal Value "item name"\), as this operation's "ref" parameter\./
    );
    expect(argsOf(verdict)).toEqual({ ref: "e151", text: "Milk" });
  });

  it("completes the arguments with the preset, in the operation's order", async () => {
    const tool: GoalLoopOperation = { ...fillTool, args: [textArg, refArg] };
    const { decide } = scripted(fillWithItemName(), {
      answers: { ref: choice("e1") },
    });

    const verdict = await step(decide, {
      capture: captureOfButtons(1),
      toolOptions: [optionOf(tool)],
      values,
    });

    expect(argsOf(verdict)).toEqual({ ref: "e1", text: "Milk" });
    expect(verdict.kind === "act" && Object.entries(verdict.chosen)).toEqual([
      ["text", { key: "item name", description: "item name: Milk" }],
      ["ref", { key: "e1", description: 'button "Item 1"' }],
    ]);
  });
});

describe("the state a request that only picks an element is sent", () => {
  /** Unnamed textboxes under named regions, with text around them. */
  function surveyCapture(): PageCapture {
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
    return { tree, elementsByRef, pomRootMarks: new Map() };
  }

  // A step that changed the page: its history entry carries what it changed.
  const history: GoalLoopStepRecord[] = [
    {
      operation: "check",
      chosen: { target: { key: "e7", description: 'checkbox "Required"' } },
      result: "ok",
      page_changed: true,
      changes: '- e7 <changed> checkbox "Required" [checked]',
      did: 'check(checkbox "Required")',
    },
  ];
  const inputsOnly = {
    ...refArg,
    closedSet: {
      kind: "ref",
      filter: (element: Element) => element instanceof HTMLInputElement,
      reach: alwaysReaches(),
    },
  } as const;

  it("carries the candidates, each with where it sits and the text around it, instead of the page", async () => {
    const tool: GoalLoopOperation = { ...clickTool, args: [inputsOnly] };
    const { decide, requests } = scripted(stageOne("click"), {
      answers: { ref: choice("e4") },
    });

    const verdict = await step(decide, {
      goal: "g",
      values: { name: "Milk" },
      history,
      capture: surveyCapture(),
      toolOptions: [optionOf(tool)],
    });

    expect(requests[1]!.state).toEqual({
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
    expect(questionsOf(requests[1]).ref!.instructions).toMatch(
      /Each option is an element of `elements` in the state/
    );
    expect(argsOf(verdict)).toEqual({ ref: "e4" });
  });

  it("tells candidates that share a role and name apart by the text of the item each sits in", async () => {
    const yaml = [
      '- list "Projects" [ref=e1]:',
      "  - listitem [ref=e2]:",
      "    - text: Website redesign",
      '    - text: "Owner: Grace"',
      '    - button "Rename" [ref=e3]',
      "  - listitem [ref=e4]:",
      '    - heading "Mobile app" [level=3] [ref=e5]',
      '    - text: "Owner: Alan"',
      "    - group [ref=e6]:",
      '      - button "Rename" [ref=e7]',
      "  - listitem [ref=e8]:",
      `    - text: ${"x".repeat(200)}`,
      '    - button "Rename" [ref=e9]',
      '- button "Add project" [ref=e10]',
    ].join("\n");
    const tree = StructuralTree.fromAriaSnapshotYaml(
      yaml,
      new SyntheticAriaRefFactory()
    );
    const elementsByRef = new Map<AriaRef, Element>();
    for (const ref of ["e3", "e7", "e9", "e10"])
      elementsByRef.set(
        AriaRefSchema.parse(ref),
        document.createElement("button")
      );
    const { decide, requests } = scripted(stageOne("click"), {
      answers: { ref: choice("e7") },
    });

    await step(decide, {
      capture: { tree, elementsByRef, pomRootMarks: new Map() },
    });

    const elements = (
      requests[1]!.state as { elements: Record<string, unknown>[] }
    ).elements;
    expect(
      Object.fromEntries(
        elements.map((element) => [element.ref, element.item_text])
      )
    ).toEqual({
      e3: "Website redesign · Owner: Grace",
      // The cell holds only the button and its name, so the row's text is used.
      e7: "Mobile app · Owner: Alan",
      e9: `${"x".repeat(119)}…`,
      // A unique role and name needs no item text.
      e10: undefined,
    });
    expect(
      elements.find((element) => element.ref === "e10")
    ).not.toHaveProperty("item_text");
  });

  it("keeps the page when the request asks anything besides the element", async () => {
    const { decide, requests } = scripted(stageOne("force_click"), {
      answers: { ref: choice("e4"), force: choice("true") },
    });

    await step(decide, {
      goal: "g",
      values: { name: "Milk" },
      history,
      capture: surveyCapture(),
      toolOptions: [optionOf(forceClickTool)],
    });

    // The state stage one was sent, page and all.
    expect(requests[1]!.state).toEqual(requests[0]!.state);
    expect(requests[1]!.state).toHaveProperty("page");
    expect(requests[1]!.state).not.toHaveProperty("elements");
    expect(questionsOf(requests[1]).ref!.instructions).not.toMatch(
      /`elements`/
    );
  });
});
