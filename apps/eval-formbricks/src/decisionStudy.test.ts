import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { recordDecisions, type DecisionRecord } from "./decisionRecorder.ts";
import {
  combinedRequest,
  onlyOneOption,
  questionKind,
  stepsOf,
  type DecisionRequestBody,
} from "./decisionStudy.ts";

const stageOne: DecisionRequestBody = {
  state: { goal: "Rename the survey", page: [] },
  questions: {
    operation: {
      type: "choice",
      instructions: "Which operation?",
      criteria: { a: "A", none: "None" },
    },
    goal_met: { type: "noul", instructions: "Met?" },
  },
};

const stageTwo: DecisionRequestBody = {
  state: { goal: "Rename the survey", elements: [{ ref: "e5" }] },
  questions: {
    ref: {
      type: "choice",
      instructions:
        'Pick the element that should receive the text "Hi" (the Goal Value "name"), as this operation\'s "ref" parameter. The operation is "fill": Fill.',
      criteria: { e5: 'textbox "Name"', none_of_these: "None" },
    },
  },
};

const record = (request: DecisionRequestBody): DecisionRecord => ({
  time: "2026-10-15T00:00:00.000Z",
  durationMs: 1,
  status: 200,
  request,
  response: { answers: {} },
});

describe("stepsOf", () => {
  it("groups the requests after a stage-one request into its step", () => {
    const steps = stepsOf([
      record(stageOne),
      record(stageTwo),
      record(stageOne),
    ]);
    expect(steps.map((step) => step.argumentRequests.length)).toEqual([1, 0]);
  });
});

describe("onlyOneOption", () => {
  it("counts the options that name a value, not the loop's extra choices", () => {
    expect(onlyOneOption(stageTwo)).toBe(true);
    expect(
      onlyOneOption({
        ...stageTwo,
        questions: {
          ref: {
            ...stageTwo.questions.ref!,
            criteria: { e5: "a", e6: "b", none_of_these: "None" },
          },
        },
      })
    ).toBe(false);
  });
});

describe("questionKind", () => {
  it("reads the kind from the loop's wording", () => {
    expect(questionKind("ref", stageTwo.questions.ref!)).toBe("element");
    expect(
      questionKind("ref", {
        type: "choice",
        instructions: "Pick the instance this operation acts on",
      })
    ).toBe("instance");
  });
});

describe("combinedRequest", () => {
  it("asks the stage-two questions under their own ids, without the chosen value, with the candidates in the state", () => {
    const combined = combinedRequest(stageOne, stageTwo, "fill");
    expect(Object.keys(combined.questions)).toEqual([
      "operation",
      "goal_met",
      "args:ref",
    ]);
    const instructions = combined.questions["args:ref"]!.instructions;
    expect(instructions).toContain('If the next operation is "fill"');
    expect(instructions).toContain(
      'Pick the element this operation acts on as its "ref" parameter.'
    );
    expect(instructions).not.toContain("Hi");
    expect(combined.state.elements).toEqual([{ ref: "e5" }]);
    expect(combined.state.page).toEqual([]);
  });
});

describe("recordDecisions", () => {
  it("writes one line per Decision Endpoint request, and nothing for other requests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "decisions-"));
    const file = path.join(dir, "decisions.jsonl");
    const browser = new EventEmitter();
    const recorder = recordDecisions(browser, file);
    const request = (url: string) => ({
      url: () => url,
      method: () => "POST",
      postData: () => JSON.stringify(stageOne),
      response: async () => ({
        status: () => 200,
        text: async () => '{"answers":{}}',
      }),
    });
    const decision = request("http://localhost:3000/api/ayme/decisions");
    const other = request("http://localhost:3000/api/other");
    for (const each of [decision, other]) {
      browser.emit("request", each);
      browser.emit("requestfinished", each);
    }
    await recorder.flush();
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      status: 200,
      request: stageOne,
      response: { answers: {} },
    });
  });
});
