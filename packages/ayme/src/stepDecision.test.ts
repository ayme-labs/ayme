// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import {
  DecisionEndpointError,
  type DecisionRequest,
  type DecisionResponse,
} from "./decisionWire";
import type { GoalLoopStepRecord } from "./handover";
import type { PageStateCapture } from "./pageState";
import type { CollectionToolItem } from "./registry";
import {
  NONE_OF_THESE_KEY,
  chunkQuestionId,
  runOffQuestionId,
  type GoalLoopOperation,
  type ToolOption,
} from "./goalLoopQuestions";
import {
  decideStep,
  type GoalLoopDecisionFunction,
  type StepInput,
} from "./stepDecision";

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

const clickTool: GoalLoopOperation = {
  name: "click",
  description: "Click an element.",
  execute: async () => null,
  requiredParams: ["ref"],
  args: [
    {
      name: "ref",
      path: ["ref"],
      optional: false,
      closedSet: { kind: "ref", filter: () => true },
    },
  ],
};

const saveTool: GoalLoopOperation = {
  name: "Form.save",
  description: "Save the form.",
  execute: async () => null,
  requiredParams: [],
  args: [],
};

/** An operation with a required free string parameter. */
const renameTool: GoalLoopOperation = {
  name: "Project.rename",
  description: "Rename the project.",
  execute: async () => null,
  requiredParams: ["name"],
  args: [
    {
      name: "name",
      path: ["name"],
      optional: false,
      closedSet: null,
      free: ["string"],
    },
  ],
};

/** A single-element tool with a boolean parameter next to its ref. */
const forceClickTool: GoalLoopOperation = {
  ...clickTool,
  name: "force_click",
  requiredParams: ["ref", "force"],
  args: [
    ...clickTool.args,
    {
      name: "force",
      path: ["force"],
      optional: false,
      closedSet: { kind: "values", values: [true, false] },
    },
  ],
};

/** A tool that goes through a collection, one instance per button of the capture. */
/** A collection item the tool is unavailable on, so never offered. */
const archivedItem: CollectionToolItem = {
  label: "items[archived]",
  element: document.createElement("li"),
  present: true,
  available: false,
  reason: "already archived",
};

const collectionTool = (
  capture: PageStateCapture,
  unavailable: CollectionToolItem[] = []
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
      closedSet: {
        kind: "instance",
        roots: [
          ...[...capture.elementsByRef.values()].map((element, index) => ({
            label: `items[${index}]`,
            element,
            present: true,
            available: true,
          })),
          ...unavailable,
        ],
      },
    },
  ],
});

const optionOf = (tool: GoalLoopOperation): ToolOption => ({
  key: tool.name,
  label: tool.description,
  tool,
});

// --- Scripted decision function ---

/** What one request is answered with: answers per question id, or a failure. */
type Turn =
  | { answers: Record<string, unknown> }
  | { answer: (request: DecisionRequest) => Record<string, unknown> }
  | { throws: unknown };

/**
 * A decision function that answers each request with the next turn, and keeps
 * the requests it was sent. A request past the last turn fails the test.
 */
function scripted(...turns: Turn[]) {
  const requests: DecisionRequest[] = [];
  const decide: GoalLoopDecisionFunction = async (
    request
  ): Promise<DecisionResponse> => {
    requests.push(request);
    const turn = turns[requests.length - 1];
    if (!turn) throw new Error(`Unexpected request ${requests.length}`);
    if ("throws" in turn) throw turn.throws;
    const answers = "answers" in turn ? turn.answers : turn.answer(request);
    return { model: "typesafe/jev-1.13", answers };
  };
  return { decide, requests };
}

/** Stage one's answers: the operation chosen, and how far the goal is met. */
const stageOne = (operation: string, goalMet = 0.1) => ({
  answers: {
    operation: {
      type: "choice",
      choice: operation,
      probabilities: { [operation]: 0.9 },
    },
    goal_met: { type: "noul", noul: goalMet },
  },
});

/** A choice answer for one question, scored 1 on the chosen key. */
const choice = (key: string) => ({
  type: "choice",
  choice: key,
  probabilities: { [key]: 1 },
});

/**
 * Answer every question of the request: `pick` names the key per question id,
 * `"none"` for "none of these".
 */
const answering =
  (pick: (id: string) => string) =>
  (request: DecisionRequest): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(request.questions).map((id) => {
        const key = pick(id);
        return [id, choice(key === "none" ? NONE_OF_THESE_KEY : key)];
      })
    );

const step = (
  decide: GoalLoopDecisionFunction,
  input: Partial<StepInput> = {}
): ReturnType<typeof decideStep> =>
  decideStep({
    goal: "do the thing",
    history: [],
    capture: captureOfButtons(3),
    toolOptions: [optionOf(clickTool), optionOf(saveTool)],
    pomDefinitions: "",
    decide,
    ...input,
  });

const ranOk = (
  record: Pick<GoalLoopStepRecord, "operation" | "chosen" | "page_changed">
): GoalLoopStepRecord => ({
  ...record,
  result: "ok",
  did: `${record.operation}(…)`,
});

// --- Tests ---

describe("a Step Decision", () => {
  it("runs an operation without parameters after stage one alone", async () => {
    const { decide, requests } = scripted(stageOne("Form.save"));

    const verdict = await step(decide);

    expect(verdict).toMatchObject({
      kind: "act",
      operation: saveTool,
      args: {},
      chosen: {},
      scores: {
        operationProbabilities: { "Form.save": 0.9 },
        goalMetScore: 0.1,
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("asks stage two for the chosen operation's ref and runs it with the ref chosen", async () => {
    const { decide, requests } = scripted(stageOne("click"), {
      answers: { ref: choice("e2") },
    });

    const verdict = await step(decide);

    expect(verdict).toMatchObject({
      kind: "act",
      operation: clickTool,
      args: { ref: "e2" },
      chosen: { ref: { key: "e2", description: 'button "Item 2"' } },
      scores: { argumentChoices: { ref: "e2" } },
    });
    expect(requests).toHaveLength(2);
    expect(Object.keys(requests[1]!.questions)).toEqual(["ref"]);
  });

  describe("stops before acting", () => {
    it("when the page offers more operations than one decision can choose from, without asking", async () => {
      const { decide, requests } = scripted();
      const toolOptions = Array.from({ length: 255 }, (_, index) =>
        optionOf({ ...saveTool, name: `Form.save${index}` })
      );

      const verdict = await step(decide, { toolOptions });

      expect(verdict).toEqual({
        kind: "stop",
        reason: "decide_failed",
        next: "The page offers 255 operations, more than one decision can choose from. Handle the goal without the Goal Loop.",
      });
      expect(requests).toEqual([]);
    });

    it("with done when the model judges the goal met, before reading the operation's arguments", async () => {
      const { decide, requests } = scripted(stageOne("click", 0.8));

      const verdict = await step(decide);

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "done",
        scores: { goalMetScore: 0.8 },
      });
      expect(requests).toHaveLength(1);
    });

    it("with no_fitting_option when the model chooses none", async () => {
      const { decide } = scripted(stageOne("none"));

      expect(await step(decide)).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
      });
    });

    it("with decide_failed, and no retry advice, when the model names an operation it was not offered", async () => {
      const { decide } = scripted(stageOne("delete_everything"));

      expect(await step(decide)).toMatchObject({
        kind: "stop",
        reason: "decide_failed",
        next: 'The model chose an unknown operation "delete_everything". Handle the goal without the Goal Loop.',
      });
    });

    it("with needs_value naming the parameter when no Goal Value fits a required free one", async () => {
      const { decide, requests } = scripted(stageOne("Project.rename"));

      const verdict = await step(decide, {
        toolOptions: [optionOf(renameTool)],
      });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        needs: { tool: "Project.rename", parameters: ["name"] },
      });
      expect(requests).toHaveLength(1);
    });

    it("with needs_value, saying which parameters no Goal Value fits", async () => {
      const { decide } = scripted(stageOne("Project.rename"));
      const renameWithOwner: GoalLoopOperation = {
        ...renameTool,
        requiredParams: ["name", "owner"],
        args: [
          ...renameTool.args,
          { ...renameTool.args[0]!, name: "owner", path: ["owner"] },
        ],
      };

      const verdict = await step(decide, {
        toolOptions: [optionOf(renameWithOwner)],
      });

      expect(verdict.kind === "stop" && verdict.next).toBe(
        'The operation "Project.rename" needs values for: name, owner, and no Goal Value fits name, owner. Call goal again with a value for name, owner in values, or call Project.rename directly.'
      );
    });

    it("with needs_value when no element on the page is one the ref may address", async () => {
      const { decide } = scripted(stageOne("click"));

      expect(
        await step(decide, { capture: captureOfButtons(0) })
      ).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        next: 'The operation "click" acts on one element, and the loop found no element on the current page it applies to. Read the page again, pick "ref" yourself and call the operation directly, or try a different approach.',
        needs: { tool: "click", parameters: ["ref"] },
      });
    });

    it("with needs_value when a collection holds more instances than one decision can offer", async () => {
      const capture = captureOfButtons(256);
      const archiveTool = collectionTool(capture);
      const { decide } = scripted(stageOne(archiveTool.name));

      expect(
        await step(decide, { capture, toolOptions: [optionOf(archiveTool)] })
      ).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        next: 'The operation "List.archive" acts on a collection instance, and the current page holds more of them than one decision can offer. Read the page again, pick "ref" yourself and call the operation directly, or try a different approach.',
        needs: { tool: "List.archive", parameters: ["ref"] },
      });
    });

    it("with needs_value naming the items it left out when it can offer none", async () => {
      const capture = captureOfButtons(0);
      const archiveTool = collectionTool(capture, [archivedItem]);
      const { decide } = scripted(stageOne(archiveTool.name));

      expect(
        await step(decide, { capture, toolOptions: [optionOf(archiveTool)] })
      ).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        next: 'The operation "List.archive" acts on a collection instance, and the loop could offer none of its items. Left out: items[archived] (unavailable: already archived). Try a different approach.',
        needs: { tool: "List.archive", parameters: ["ref"] },
      });
    });

    it("with needs_value when a closed set holds more values than one decision can answer", async () => {
      const pickTool: GoalLoopOperation = {
        name: "Form.pick",
        description: "Pick a code.",
        execute: async () => null,
        requiredParams: ["code"],
        args: [
          {
            name: "code",
            path: ["code"],
            optional: false,
            closedSet: {
              kind: "values",
              values: Array.from({ length: 300 }, (_, index) => `c${index}`),
            },
          },
        ],
      };
      const { decide } = scripted(stageOne("Form.pick"));

      expect(
        await step(decide, { toolOptions: [optionOf(pickTool)] })
      ).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        next: 'The operation "Form.pick" needs a value for "code", and its 300 allowed values are not a choice one decision can answer. Provide the value and call the operation directly, or try a different approach.',
        needs: { tool: "Form.pick", parameters: ["code"] },
      });
    });

    it("with no_fitting_option when every chunk of a ref answers none of these", async () => {
      const { decide } = scripted(stageOne("click"), {
        answer: answering(() => "none"),
      });

      expect(
        await step(decide, { capture: captureOfButtons(300) })
      ).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
        next: 'No element on the current page fits the operation "click". Navigate to a different page or try a different approach.',
      });
    });
    it("with no_fitting_option naming the items left out when a collection item answers none of these", async () => {
      const capture = captureOfButtons(2);
      const archiveTool = collectionTool(capture, [archivedItem]);
      const { decide } = scripted(stageOne(archiveTool.name), {
        answer: answering(() => "none"),
      });

      expect(
        await step(decide, { capture, toolOptions: [optionOf(archiveTool)] })
      ).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
        next: 'No element on the current page fits the operation "List.archive". Left out: items[archived] (unavailable: already archived). Navigate to a different page or try a different approach.',
      });
    });
  });

  describe("a decision it could not obtain or use", () => {
    it("advises a retry when the endpoint failure is retryable, and carries no scores before stage one is read", async () => {
      const { decide } = scripted({
        throws: new DecisionEndpointError(
          "The Decision Endpoint /api/decisions answered 503 Busy",
          { code: "rejected", status: 503 }
        ),
      });

      expect(await step(decide)).toEqual({
        kind: "stop",
        reason: "decide_failed",
        next: "The Decision Endpoint /api/decisions answered 503 Busy. Retry, or handle the goal without the Goal Loop.",
      });
    });

    it("says stage one's answers could not be read", async () => {
      const { decide } = scripted({ answers: { operation: choice("click") } });

      const verdict = await step(decide);

      expect(verdict).toMatchObject({ kind: "stop", reason: "decide_failed" });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /^The decision function's answers could not be read: .*goal_met.*Handle the goal without the Goal Loop\.$/
      );
      expect(verdict.scores).toBeUndefined();
    });

    it("says so when stage one's Goal Value answer names no option it offered", async () => {
      const { decide, requests } = scripted({
        answer: (request) => ({
          ...stageOne("Project.rename").answers,
          ...Object.fromEntries(
            Object.keys(request.questions)
              .filter((id) => id !== "operation" && id !== "goal_met")
              .map((id) => [id, choice("not_offered")])
          ),
        }),
      });

      const verdict = await step(decide, {
        toolOptions: [optionOf(renameTool)],
        values: { newName: "Apollo" },
      });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "decide_failed",
        scores: { goalMetScore: 0.1 },
      });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /^The decision function's answers could not be read: .*Handle the goal without the Goal Loop\.$/
      );
      expect(requests).toHaveLength(1);
    });

    it("keeps the stage-one scores when stage two fails", async () => {
      const { decide } = scripted(stageOne("click"), {
        throws: new Error("socket hang up"),
      });

      expect(await step(decide)).toMatchObject({
        kind: "stop",
        reason: "decide_failed",
        next: "The decision function failed: socket hang up. Retry, or handle the goal without the Goal Loop.",
        scores: {
          operationProbabilities: { click: 0.9 },
          goalMetScore: 0.1,
        },
      });
    });
  });

  describe("a ref over the option cap", () => {
    const capture = captureOfButtons(300);
    const firstChunk = chunkQuestionId("ref", 1, ["ref"]);
    const secondChunk = chunkQuestionId("ref", 2, ["ref"]);
    const runOff = runOffQuestionId("ref", ["ref"]);

    it("asks a run-off among the elements several chunks named, then runs the one it picks", async () => {
      const { decide, requests } = scripted(
        stageOne("click"),
        {
          answer: answering((id) =>
            id === firstChunk ? "e10" : id === secondChunk ? "e280" : "none"
          ),
        },
        { answers: { [runOff]: choice("e280") } }
      );

      const verdict = await step(decide, { capture });

      expect(verdict).toMatchObject({
        kind: "act",
        args: { ref: "e280" },
        scores: {
          runOff: true,
          argumentChoices: {
            [firstChunk]: "e10",
            [secondChunk]: "e280",
            [runOff]: "e280",
          },
        },
      });
      expect(requests).toHaveLength(3);
      expect(Object.keys(requests[2]!.questions)).toEqual([runOff]);
    });

    it("marks the run-off on the scores even when asking it fails", async () => {
      const { decide } = scripted(
        stageOne("click"),
        {
          answer: answering((id) =>
            id === firstChunk ? "e10" : id === secondChunk ? "e280" : "none"
          ),
        },
        { throws: new Error("socket hang up") }
      );

      expect(await step(decide, { capture })).toMatchObject({
        kind: "stop",
        reason: "decide_failed",
        next: "The decision function failed: socket hang up. Retry, or handle the goal without the Goal Loop.",
        scores: {
          runOff: true,
          argumentChoices: { [firstChunk]: "e10", [secondChunk]: "e280" },
        },
      });
    });
  });

  describe("the repeat stop", () => {
    const clickedE2 = {
      operation: "click",
      chosen: { ref: { key: "e2", description: 'button "Item 2"' } },
    };

    it("stops with no_progress before running a step again that did not change the page", async () => {
      const { decide } = scripted(stageOne("click"), {
        answers: { ref: choice("e2") },
      });

      const verdict = await step(decide, {
        history: [ranOk({ ...clickedE2, page_changed: false })],
      });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "no_progress",
        needs: { tool: "click", parameters: ["ref"] },
        scores: { argumentChoices: { ref: "e2" } },
      });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /^The loop is repeating click\(…\): it chose the same step 2 times in a row, and the last run did not change the page\./
      );
    });

    it("knows a step by its operation and the keys chosen, not their descriptions", async () => {
      const { decide } = scripted(stageOne("click"), {
        answers: { ref: choice("e2") },
      });

      const verdict = await step(decide, {
        history: [
          ranOk({
            operation: "click",
            chosen: { ref: { key: "e2", description: 'button "Renamed"' } },
            page_changed: false,
          }),
        ],
      });

      expect(verdict).toMatchObject({ kind: "stop", reason: "no_progress" });
    });

    it("knows the same choices recorded in another parameter order as the same step", async () => {
      const { decide } = scripted(stageOne("force_click"), {
        answers: { ref: choice("e2"), force: choice("true") },
      });

      const verdict = await step(decide, {
        toolOptions: [optionOf(forceClickTool)],
        history: [
          ranOk({
            operation: "force_click",
            chosen: {
              force: { key: "true", description: "true" },
              ref: { key: "e2", description: 'button "Item 2"' },
            },
            page_changed: false,
          }),
        ],
      });

      expect(verdict).toMatchObject({ kind: "stop", reason: "no_progress" });
    });

    it("runs a step that differs from the one before", async () => {
      const { decide } = scripted(stageOne("click"), {
        answers: { ref: choice("e2") },
      });

      const verdict = await step(decide, {
        history: [
          ranOk({
            operation: "click",
            chosen: { ref: { key: "e1", description: 'button "Item 1"' } },
            page_changed: false,
          }),
        ],
      });

      expect(verdict.kind).toBe("act");
    });

    it("stops a step chosen a third time in a row even though the page changed each time", async () => {
      const { decide } = scripted(stageOne("click"), {
        answers: { ref: choice("e2") },
      });

      const verdict = await step(decide, {
        history: [
          ranOk({ ...clickedE2, page_changed: true }),
          ranOk({ ...clickedE2, page_changed: true }),
        ],
      });

      expect(verdict).toMatchObject({ kind: "stop", reason: "no_progress" });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /chose the same step 3 times in a row\. It stopped/
      );
    });

    it("runs a step again once when the run before changed the page", async () => {
      const { decide } = scripted(stageOne("click"), {
        answers: { ref: choice("e2") },
      });

      const verdict = await step(decide, {
        history: [ranOk({ ...clickedE2, page_changed: true })],
      });

      expect(verdict.kind).toBe("act");
    });
  });
});
