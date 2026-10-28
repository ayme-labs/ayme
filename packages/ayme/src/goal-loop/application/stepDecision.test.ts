// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DecisionEndpointError } from "../domain/decisionWire";
import type { GoalLoopOperation } from "../domain/goalLoopOperations";
import { NONE_OF_THESE_KEY } from "../domain/goalLoopQuestions";
import { alwaysReaches } from "../../test-utils/reach.testSupport";
import {
  answering,
  archiveTool,
  archivedItem,
  captureOfButtons,
  choice,
  clickTool,
  collectionTool,
  criteriaKeys,
  forceClickTool,
  lookalikeClickTool,
  optionOf,
  questionsOf,
  ranOk,
  renameTool,
  saveTool,
  scripted,
  stageOne,
  step,
} from "../test-utils/stepDecision.testSupport";

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
    // A ref within the cap offers its elements only, without none of these.
    expect(criteriaKeys(requests[1], "ref")).toEqual(["e1", "e2", "e3"]);
    expect(questionsOf(requests[1]).ref!.instructions).not.toContain(
      NONE_OF_THESE_KEY
    );
  });

  it("records the choice of a stage-two answer that carries no scores, and no scores for it", async () => {
    const { decide } = scripted(stageOne("click"), {
      answers: { ref: { type: "choice", choice: "e2" } },
    });

    const verdict = await step(decide);

    expect(verdict).toMatchObject({ kind: "act", args: { ref: "e2" } });
    expect(verdict.scores?.argumentChoices).toEqual({ ref: "e2" });
    expect(Object.keys(verdict.scores!.argumentProbabilities!)).toEqual([]);
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

    it("with done when the model has nothing left to run and judges the goal met", async () => {
      const { decide, requests } = scripted(stageOne("none", 0.8));

      const verdict = await step(decide);

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "done",
        next: "The goal has been achieved. Continue with your next task.",
        scores: { goalMetScore: 0.8 },
      });
      expect(requests).toHaveLength(1);
    });

    it("with unverified, not done, when no step has run and the model only judges no step outstanding", async () => {
      const { decide } = scripted(stageOne("none", 0.47, 0.37));

      expect(await step(decide)).toEqual({
        kind: "stop",
        reason: "unverified",
        next: "The Goal Loop could not tell whether the goal holds on the current page. Read the page with snapshot to check it, or call goal again with the goal phrased as the action to take.",
        scores: expect.objectContaining({
          goalMetScore: 0.47,
          goalRemainingScore: 0.37,
        }),
      });
    });

    it.each([
      [0.7, "done"],
      [0.69, "unverified"],
      [0.3, "unverified"],
      [0.29, "no_fitting_option"],
    ])(
      "by goal_met against the bars when the model has nothing left to run: %s hands back %s",
      async (goalMet, reason) => {
        const { decide } = scripted(stageOne("none", goalMet, 0.9));

        expect(await step(decide)).toMatchObject({ kind: "stop", reason });
      }
    );

    it.each([
      [0.3, "done"],
      [0.31, "unverified"],
    ])(
      "after a step that ran ok, by goal_remaining as well: %s hands back %s",
      async (goalRemaining, reason) => {
        const { decide } = scripted(stageOne("none", 0.4, goalRemaining));

        const verdict = await step(decide, {
          history: [
            ranOk({ operation: "click", chosen: {}, page_changed: true }),
          ],
        });

        expect(verdict).toMatchObject({ kind: "stop", reason });
      }
    );

    it("with no_fitting_option, not done, when the last step failed and the model only judges no step outstanding", async () => {
      const { decide } = scripted(stageOne("none", 0.1, 0.1));

      const verdict = await step(decide, {
        history: [
          {
            operation: "click",
            chosen: {},
            result: "action exploded",
            page_changed: false,
            did: "click()",
          },
        ],
      });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
      });
    });

    it("runs the chosen operation although the model judges the goal met: its effect may never show on the page", async () => {
      const { decide, requests } = scripted(stageOne("click", 0.8, 0.1), {
        answers: { ref: choice("e2") },
      });

      const verdict = await step(decide);

      expect(verdict).toMatchObject({
        kind: "act",
        operation: clickTool,
        args: { ref: "e2" },
        scores: { goalMetScore: 0.8, goalRemainingScore: 0.1 },
      });
      expect(requests).toHaveLength(2);
    });

    it("with no_fitting_option when the model chooses none", async () => {
      const { decide } = scripted(stageOne("none"));

      expect(await step(decide)).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
        next: "No available operation fits the goal on the current page. Navigate to a different page or try a different approach.",
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
      // The ref is one the loop can ask about; the two free strings are not.
      const renameItem: GoalLoopOperation = {
        ...renameTool,
        requiredParams: ["ref", "name", "owner"],
        args: [
          ...clickTool.args,
          ...renameTool.args,
          { ...renameTool.args[0]!, name: "owner", path: ["owner"] },
        ],
      };

      expect(
        await step(decide, { toolOptions: [optionOf(renameItem)] })
      ).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        next: 'The operation "Project.rename" needs values for: ref, name, owner, and no Goal Value fits name, owner. Call goal again with a value for name, owner in values, or call Project.rename directly.',
        needs: {
          tool: "Project.rename",
          parameters: ["ref", "name", "owner"],
        },
      });
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

    it.each([
      [3, "3 elements"],
      [1, "1 element"],
    ])(
      "with needs_value counting the elements that match the ref but that the operation would not reach: %i",
      async (count, elements) => {
        const unreachableClick: GoalLoopOperation = {
          ...clickTool,
          args: [
            {
              ...clickTool.args[0]!,
              closedSet: {
                kind: "ref",
                filter: () => false,
                matches: () => true,
                reach: alwaysReaches(),
              },
            },
          ],
        };
        const { decide, requests } = scripted(stageOne("click"));

        const verdict = await step(decide, {
          capture: captureOfButtons(count),
          toolOptions: [optionOf(unreachableClick)],
        });

        expect(verdict).toMatchObject({
          kind: "stop",
          reason: "needs_value",
          next: `The operation "click" acts on one element; ${elements} on the current page match it, and the operation would reach none of them.`,
          needs: { tool: "click", parameters: ["ref"] },
        });
        expect(requests).toHaveLength(1);
      }
    );

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
        next: 'The operation "List.archive" acts on a collection instance, and the loop could offer none of its items. Left out: List (unavailable: already archived). Try a different approach.',
        needs: { tool: "List.archive", parameters: ["ref"] },
      });
    });

    it("with needs_value naming each item it left out with why, when it can offer none", async () => {
      const capture = captureOfButtons(1);
      const tool = archiveTool([
        // An available item the capture holds no ref for.
        {
          element: document.createElement("li"),
          present: true,
          available: true,
        },
        {
          element: [...capture.elementsByRef.values()][0]!,
          present: true,
          available: false,
          reason: "already archived",
        },
      ]);
      const { decide, requests } = scripted(stageOne(tool.name));

      expect(
        await step(decide, { capture, toolOptions: [optionOf(tool)] })
      ).toMatchObject({
        kind: "stop",
        reason: "needs_value",
        next: 'The operation "List.archive" acts on a collection instance, and the loop could offer none of its items. Left out: List (no ref in the page state), List on ref "e1" (unavailable: already archived). Try a different approach.',
        needs: { tool: "List.archive", parameters: ["ref"] },
      });
      expect(requests).toHaveLength(1);
    });

    it("with needs_value naming every item it left out, however many", async () => {
      const capture = captureOfButtons(0);
      const items = Array.from({ length: 12 }, () => ({
        element: document.createElement("li"),
        present: true,
        available: false,
        reason: "it is archived",
      }));
      const tool = archiveTool(items);
      const { decide } = scripted(stageOne(tool.name));

      const verdict = await step(decide, {
        capture,
        toolOptions: [optionOf(tool)],
      });

      expect(verdict).toMatchObject({ kind: "stop", reason: "needs_value" });
      expect(verdict.kind === "stop" && verdict.next).toBe(
        `The operation "List.archive" acts on a collection instance, and the loop could offer none of its items. Left out: ${items.map(() => `List (unavailable: it is archived)`).join(", ")}. Try a different approach.`
      );
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

      const verdict = await step(decide, { capture: captureOfButtons(300) });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
        next: 'No element on the current page fits the operation "click". Navigate to a different page or try a different approach.',
      });
      // Every chunk's answer is kept on the stop.
      expect(Object.keys(verdict.scores?.argumentProbabilities ?? {})).toEqual([
        "ref_1",
        "ref_2",
      ]);
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
        next: 'No element on the current page fits the operation "List.archive". Left out: List (unavailable: already archived). Navigate to a different page or try a different approach.',
      });
    });

    it("with no_fitting_option when a collection item answers none of these, having offered only the items it could, and naming the others with why", async () => {
      const capture = captureOfButtons(2);
      const [first, second] = [...capture.elementsByRef.values()];
      const tool = archiveTool([
        {
          element: first!,
          present: true,
          available: false,
          reason: "already archived",
        },
        { element: second!, present: true, available: true },
        // An available item the capture holds no ref for.
        {
          element: document.createElement("li"),
          present: true,
          available: true,
        },
        // Unavailable without an Availability Reason.
        {
          element: document.createElement("li"),
          present: true,
          available: false,
        },
      ]);
      const { decide, requests } = scripted(stageOne(tool.name), {
        answer: answering(() => "none"),
      });

      const verdict = await step(decide, {
        capture,
        toolOptions: [optionOf(tool)],
      });

      // The one item it can offer, then none of these.
      expect(questionsOf(requests[1]).ref!.criteria).toEqual({
        e2: 'List on ref "e2" (button "Item 2")',
        [NONE_OF_THESE_KEY]: "None of these; the item is not offered.",
      });
      expect(criteriaKeys(requests[1], "ref")).toEqual([
        "e2",
        NONE_OF_THESE_KEY,
      ]);
      expect(questionsOf(requests[1]).ref!.instructions).toContain(
        `Choose "${NONE_OF_THESE_KEY}" when the item is not among these.`
      );
      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
        next: 'No element on the current page fits the operation "List.archive". Left out: List on ref "e1" (unavailable: already archived), List (no ref in the page state), List (unavailable). Navigate to a different page or try a different approach.',
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
              .filter(
                (id) =>
                  id !== "operation" &&
                  id !== "goal_met" &&
                  id !== "goal_remaining"
              )
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
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /"not_offered" for "value:Project\.rename\.name", which is not one of the offered options/
      );
      expect(requests).toHaveLength(1);
    });

    it("says a response without answers could not be read, without retry advice", async () => {
      const { decide } = scripted({ responds: null });

      const verdict = await step(decide);

      expect(verdict).toMatchObject({ kind: "stop", reason: "decide_failed" });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /^The decision function's answers could not be read: .*Handle the goal without the Goal Loop\.$/
      );
    });

    it("keeps the stage-two answers read before one it cannot read", async () => {
      const { decide } = scripted(stageOne("force_click"), {
        answers: { ref: choice("e2"), force: choice("not_offered") },
      });

      const verdict = await step(decide, {
        toolOptions: [optionOf(forceClickTool)],
      });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "decide_failed",
        scores: {
          argumentChoices: { ref: "e2" },
          argumentProbabilities: { ref: { e2: 1 } },
        },
      });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /^The decision function's answers could not be read: .*Handle the goal without the Goal Loop\.$/
      );
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
    const firstChunk = "ref_1";
    const secondChunk = "ref_2";
    const runOff = "ref_run_off";

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
      expect(requests[2]!.questions[runOff]).toMatchObject({
        criteria: { e10: 'button "Item 10"', e280: 'button "Item 280"' },
      });
      expect(
        Object.keys(
          (requests[2]!.questions[runOff] as { criteria: object }).criteria
        )
      ).toEqual(["e10", "e280"]);
      expect(questionsOf(requests[2])[runOff]!.instructions).toContain(
        '"click"'
      );
      expect(verdict).toMatchObject({
        chosen: { ref: { key: "e280", description: 'button "Item 280"' } },
      });
      // The chunk answers and the run-off answer are all recorded.
      expect(Object.keys(verdict.scores!.argumentProbabilities!)).toEqual([
        firstChunk,
        secondChunk,
        runOff,
      ]);
      expect(verdict.scores!.argumentProbabilities![runOff]).toEqual({
        e280: 1,
      });
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

    it("cuts the options into document-order chunks of at most 254 plus none of these, all in the one stage-two request", async () => {
      const { decide, requests } = scripted(stageOne("click"), {
        answer: answering(() => "none"),
      });

      const verdict = await step(decide, { capture: captureOfButtons(600) });

      // ⌈600 / 254⌉ = 3 chunks, all for the one parameter, each with its own id.
      const chunks = ["ref_1", "ref_2", "ref_3"];
      expect(requests).toHaveLength(2);
      expect(Object.keys(requests[1]!.questions)).toEqual(chunks);
      for (const id of chunks) {
        const keys = criteriaKeys(requests[1], id);
        expect(keys.length).toBeLessThanOrEqual(255);
        // "None of these" is the last option of every chunk and names no ref.
        expect(keys.at(-1)).toBe(NONE_OF_THESE_KEY);
        expect(questionsOf(requests[1])[id]!.instructions).toContain('"click"');
      }
      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "no_fitting_option",
      });
      // Together the chunks hold every option exactly once, in document order.
      expect(
        chunks.flatMap((id) => criteriaKeys(requests[1], id).slice(0, -1))
      ).toEqual(Array.from({ length: 600 }, (_, index) => `e${index + 1}`));
    });

    it("takes one more chunk than would overflow: two chunks hold at most 508 elements", async () => {
      const { decide, requests } = scripted(stageOne("click"), {
        answer: answering(() => "none"),
      });

      await step(decide, { capture: captureOfButtons(509) });

      const ids = Object.keys(requests[1]!.questions);
      expect(ids).toHaveLength(3);
      for (const id of ids)
        expect(criteriaKeys(requests[1], id).length).toBeLessThanOrEqual(255);
    });

    it("keeps a question within the cap as one question without none of these", async () => {
      const { decide, requests } = scripted(stageOne("click"), {
        answers: { ref: choice("e255") },
      });

      const verdict = await step(decide, { capture: captureOfButtons(255) });

      expect(Object.keys(requests[1]!.questions)).toEqual(["ref"]);
      const keys = criteriaKeys(requests[1], "ref");
      expect(keys).toHaveLength(255);
      expect(keys).not.toContain(NONE_OF_THESE_KEY);
      expect(verdict).toMatchObject({ kind: "act", args: { ref: "e255" } });
    });

    it("acts on the one chunk that names an element", async () => {
      const chunks = ["ref_1", "ref_2", "ref_3"];
      const { decide, requests } = scripted(stageOne("click"), {
        answer: answering((id) => (id === chunks[1] ? "e300" : "none")),
      });

      const verdict = await step(decide, { capture: captureOfButtons(600) });

      expect(verdict).toMatchObject({
        kind: "act",
        args: { ref: "e300" },
        chosen: { ref: { key: "e300", description: 'button "Item 300"' } },
      });
      expect(verdict.kind === "act" && verdict.args).toEqual({ ref: "e300" });
      expect(requests).toHaveLength(2);
      // Every chunk's answer is recorded.
      expect(Object.keys(verdict.scores!.argumentChoices!)).toEqual(chunks);
      expect(Object.keys(verdict.scores!.argumentProbabilities!)).toEqual(
        chunks
      );
    });

    it("stops when the run-off's answer names an element it did not offer", async () => {
      const { decide } = scripted(
        stageOne("click"),
        {
          answer: answering((id) =>
            id === firstChunk ? "e10" : id === secondChunk ? "e280" : "none"
          ),
        },
        { answers: { [runOff]: choice("e20") } }
      );

      const verdict = await step(decide, { capture });

      expect(verdict).toMatchObject({
        kind: "stop",
        reason: "decide_failed",
        scores: { runOff: true },
      });
      // The chunks' answers stay on the stop; the unread run-off adds none.
      expect(verdict.scores?.argumentChoices).toEqual({
        [firstChunk]: "e10",
        [secondChunk]: "e280",
      });
      expect(verdict.kind === "stop" && verdict.next).toMatch(
        /^The decision function's answers could not be read: .*"e20".*not one of the offered options.*Handle the goal without the Goal Loop\.$/
      );
    });

    it("asks the operation's other parameters alongside the chunks, and the run-off adds the ref", async () => {
      const chunks = ["ref_1", "ref_2"];
      const { decide, requests } = scripted(
        stageOne("force_click"),
        {
          answers: {
            [chunks[0]!]: choice("e5"),
            [chunks[1]!]: choice("e299"),
            force: choice("true"),
          },
        },
        { answers: { ref_run_off: choice("e5") } }
      );

      const verdict = await step(decide, {
        capture,
        toolOptions: [optionOf(forceClickTool)],
      });

      expect(Object.keys(requests[1]!.questions)).toEqual([...chunks, "force"]);
      // The other parameter is already chosen; the run-off asks only the ref.
      expect(Object.keys(requests[2]!.questions)).toEqual(["ref_run_off"]);
      expect(verdict.kind === "act" && verdict.args).toEqual({
        force: true,
        ref: "e5",
      });
      expect(verdict.kind === "act" && verdict.chosen).toEqual({
        force: { key: "true", description: "true" },
        ref: { key: "e5", description: 'button "Item 5"' },
      });
    });

    it("never gives a chunk or the run-off the id of a parameter of the operation", async () => {
      // "ref_" starts other parameter names, so the derived ids use "ref__".
      const chunks = ["ref__1", "ref__2"];
      const lookalikeRunOff = "ref__run_off";
      const { decide, requests } = scripted(
        stageOne("lookalike_click"),
        {
          answers: {
            [chunks[0]!]: choice("e5"),
            [chunks[1]!]: choice("e299"),
            ref_1: choice("right"),
            ref_run_off: choice("false"),
          },
        },
        { answers: { [lookalikeRunOff]: choice("e299") } }
      );

      const verdict = await step(decide, {
        capture,
        toolOptions: [optionOf(lookalikeClickTool)],
      });

      // Two chunks and the two other parameters: four questions, four ids.
      const asked = Object.keys(requests[1]!.questions);
      expect(asked).toEqual([...chunks, "ref_1", "ref_run_off"]);
      expect(new Set(asked).size).toBe(4);
      expect(Object.keys(requests[2]!.questions)).toEqual([lookalikeRunOff]);
      expect(asked).not.toContain(lookalikeRunOff);
      // Each answer fills the parameter its question belongs to.
      expect(verdict.kind === "act" && verdict.args).toEqual({
        ref: "e299",
        ref_1: "right",
        ref_run_off: false,
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
