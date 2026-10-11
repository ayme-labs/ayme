import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { agentCursor } from "./agentCalls.testSupport";
import type { PomManifest, ToolManifest } from "./contracts";
import { createPage } from "./browserPage";
import { errorText } from "./errors";
import { agentTools } from "./publication.testSupport";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createAyme } from "./runtime";
import {
  configureGoalLoop,
  getLastGoalLoopRunResult,
  type GoalLoopDecisionFunction,
} from "./goalLoop";
import type { CustomTool } from "./elementTools";
import {
  NONE_OF_THESE_KEY,
  listValueQuestionId,
  chunkQuestionId,
  runOffQuestionId,
} from "./goalLoopQuestions";
import {
  getPageStateCaptureForDocument,
  resolvePageStateRefs,
} from "./pageState";
import { renderChangeRecord } from "./changeRecord";
import {
  AriaRefSchema,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

/** The parameters of the click Browser Tool. */
const CLICK_PARAMETERS = ["target"];

/** The parameters of the select_option Browser Tool. */
const SELECT_OPTION_PARAMETERS = ["target", "values"];

/** The id of the list question about select_option's `ordinal`-th Goal Value. */
const optionValueQuestion = (ordinal: number) =>
  listValueQuestionId("values", ordinal, SELECT_OPTION_PARAMETERS);

// --- Fixtures ---

const action = (methodName: string, toolName = methodName): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  parameters: [],
});

const actionWithParam = (
  methodName: string,
  toolName = methodName
): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  parameters: [{ name: "value", optional: false, schema: { type: "string" } }],
});

const actionWithParameters = (
  methodName: string,
  toolName: string,
  parameters: ToolManifest["parameters"]
): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  parameters,
});

const root = () =>
  ({ memberName: "root", kind: "locator", access: "field" }) as const;

const collection = (memberName: string, componentClassName: string) =>
  ({
    memberName,
    kind: "component",
    access: "field",
    componentClassName,
    collection: true,
  }) as const;

const manifest = (
  className: string,
  members: PomManifest["members"],
  tools: ToolManifest[] = [],
  components: PomManifest["components"] = []
): PomManifest => ({
  className,
  members,
  tools,
  components,
});

// --- Scripted fake decision function ---

/**
 * Stage two: which option to choose — by key or description, by position in
 * the offered options, or `raw` to answer with something not offered.
 */
type ScriptedChoice = string | { nth: number } | { raw: string };

/**
 * A list scripts the chunks of one parameter over the option cap: each chunk
 * answers with the first entry it offers, or "none of these".
 */
type ScriptedArgument = ScriptedChoice | ScriptedChoice[];

/** The score a list question about one Goal Value answers with. */
type ScriptedNoul = { noul: number };

type ScriptedAnswer = {
  operation: string;
  goal_met: number;
  /**
   * Per parameter of the chosen operation, or per question id (a run-off, or
   * a list question about one Goal Value).
   */
  arguments?: Record<string, ScriptedArgument | ScriptedNoul>;
};

const asList = (
  wanted: ScriptedArgument | undefined
): ScriptedChoice[] | undefined =>
  wanted === undefined || Array.isArray(wanted) ? wanted : [wanted];

/**
 * The script for a question: by its id, which is the parameter's name or a
 * run-off's id, else by the parameter whose chunk it is. Only click is asked in
 * chunks here, so chunk ids are those of click's parameters.
 */
function scriptFor(
  wanted: Record<string, ScriptedArgument | ScriptedNoul>,
  questionId: string,
  questionCount: number
): ScriptedArgument | ScriptedNoul | undefined {
  if (wanted[questionId] !== undefined) return wanted[questionId];
  const parameter = Object.keys(wanted).find((candidate) =>
    Array.from({ length: questionCount }, (_, index) =>
      chunkQuestionId(candidate, index + 1, CLICK_PARAMETERS)
    ).includes(questionId)
  );
  return parameter === undefined
    ? undefined
    : asList(wanted[parameter] as ScriptedArgument);
}

const isNoul = (
  wanted: ScriptedArgument | ScriptedNoul
): wanted is ScriptedNoul => typeof wanted === "object" && "noul" in wanted;

/** Answer every argument question without the optional probabilities. */
function withoutArgumentProbabilities(
  decide: GoalLoopDecisionFunction
): GoalLoopDecisionFunction {
  return async (request) => {
    const response = await decide(request);
    if ("operation" in request.questions) return response;
    const answers = structuredClone(
      response.answers as Record<string, { probabilities?: unknown }>
    );
    for (const answer of Object.values(answers)) delete answer.probabilities;
    return { ...response, answers };
  };
}

type Criteria = Record<string, string>;

function criteriaOf(request: DecisionRequest): Record<string, Criteria> {
  const questions = request.questions as Record<
    string,
    { criteria?: Criteria }
  >;
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      question.criteria ?? {},
    ])
  );
}

/** The type of every question of a request, by id. */
function questionTypesOf(request: DecisionRequest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.questions as Record<string, { type: string }>).map(
      ([id, question]) => [id, question.type]
    )
  );
}

function choiceAnswer(criteria: Criteria, chosenKey: string) {
  const probabilities: Record<string, number> = {};
  for (const key of Object.keys(criteria))
    probabilities[key] = key === chosenKey ? 1 : 0;
  return { type: "choice", choice: chosenKey, confidence: 1, probabilities };
}

/**
 * The key of the option the script names: by key, by description, or by the
 * start of a description (an instance label). A list names the first of its
 * entries this question offers, else "none of these".
 */
function keyFor(criteria: Criteria, wanted: ScriptedArgument): string {
  if (Array.isArray(wanted)) {
    for (const choice of wanted) {
      const key = offeredKey(criteria, choice);
      if (key !== undefined) return key;
    }
    return NONE_OF_THESE_KEY;
  }
  const key = offeredKey(criteria, wanted);
  if (key === undefined)
    throw new Error(
      `No option ${JSON.stringify(wanted)} among ${JSON.stringify(criteria)}`
    );
  return key;
}

function offeredKey(
  criteria: Criteria,
  wanted: ScriptedChoice
): string | undefined {
  if (typeof wanted === "object")
    return "raw" in wanted ? wanted.raw : nthKey(criteria, wanted.nth);
  return (
    Object.keys(criteria).find(
      (candidate) => candidate === wanted || criteria[candidate] === wanted
    ) ??
    Object.keys(criteria).find((candidate) =>
      criteria[candidate]?.startsWith(wanted)
    )
  );
}

function nthKey(criteria: Criteria, nth: number): string {
  const key = Object.keys(criteria)[nth];
  if (key === undefined)
    throw new Error(`No option ${nth} among ${JSON.stringify(criteria)}`);
  return key;
}

function scriptedDecisionFn(
  answers: ScriptedAnswer[]
): GoalLoopDecisionFunction {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const criteria = criteriaOf(request);

    // Stage two: one choice question per parameter of the chosen operation,
    // or per chunk of a parameter over the option cap, and one noul per Goal
    // Value of a list parameter.
    if (!criteria.operation) {
      const current = answers[step - 1];
      const wanted = current?.arguments ?? {};
      const stageTwo: Record<string, unknown> = {};
      for (const [id, options] of Object.entries(criteria)) {
        // A chunk answers from its parameter's script with what it offers.
        const want = scriptFor(wanted, id, Object.keys(criteria).length);
        if (want === undefined)
          throw new Error(`No scripted argument for "${id}"`);
        stageTwo[id] = isNoul(want)
          ? { type: "noul", noul: want.noul }
          : choiceAnswer(options, keyFor(options, want));
      }
      return { model: "typesafe/jev-1.13", answers: stageTwo };
    }

    const current = answers[step];
    if (!current) throw new Error(`No scripted answer for step ${step}`);
    step++;

    return {
      model: "typesafe/jev-1.13",
      answers: {
        operation: choiceAnswer(criteria.operation, current.operation),
        goal_met: { type: "noul", noul: current.goal_met },
      },
    };
  };
}

function failingDecisionFn(error: Error): GoalLoopDecisionFunction {
  return async () => {
    throw error;
  };
}

/** Wrap a decision function so a test can read the requests it was sent. */
function recording(decide: GoalLoopDecisionFunction) {
  const requests: DecisionRequest[] = [];
  return {
    requests,
    decide: (async (request) => {
      // A snapshot: the loop keeps appending to the history the state holds.
      requests.push(structuredClone(request));
      return decide(request);
    }) satisfies GoalLoopDecisionFunction,
  };
}

/**
 * A Handover without its run's Change Record. The tests here share one
 * document, so that record starts at whatever an earlier test left as the
 * agent's page; handoverChanges.browser.test.ts covers it.
 */
function withoutChanges(handover: unknown): unknown {
  const rest = { ...(handover as Record<string, unknown>) };
  delete rest.changes;
  return rest;
}

// --- Test setup ---

describe("Goal Loop goal in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let stop: (() => void) | undefined;
  let clickCount: number;

  beforeEach(() => {
    document.body.innerHTML = "";
    clickCount = 0;
    page = createPage();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    configureGoalLoop(undefined);
    document.body.innerHTML = "";
  });

  function startRuntime(
    goalLoop: GoalLoopDecisionFunction,
    customTools?: CustomTool[]
  ) {
    const runtime = createAyme({
      pageFactory: () => page,
      goalLoop,
      customTools,
    });
    stop = runtime.start();
    return runtime;
  }

  /** Start a runtime session; its `goal` tool as the agent calls it. */
  async function getPublishedPursueGoal(
    goalLoop: GoalLoopDecisionFunction,
    customTools?: CustomTool[]
  ) {
    startRuntime(goalLoop, customTools);
    return {
      execute: (input: unknown) => agentTools().call("goal", input),
    };
  }

  function setupDom() {
    document.body.innerHTML = `
      <main>
        <button id="save">Save changes</button>
        <input id="name" aria-label="Name">
      </main>
    `;
    document.querySelector("#save")!.addEventListener("click", () => {
      clickCount++;
    });
  }

  async function registerPom(goalLoop: GoalLoopDecisionFunction) {
    setupDom();
    class App {
      root = page.locator("main");
      save() {
        (document.querySelector("#save") as HTMLButtonElement).click();
      }
    }
    registerCompiledPom(
      App,
      manifest("App", [root()], [action("save", "App.save")])
    );
    const tool = await getPublishedPursueGoal(goalLoop);
    createPageRegistration(App);
    return tool;
  }

  async function registerPomWithParam(goalLoop: GoalLoopDecisionFunction) {
    setupDom();
    class App {
      root = page.locator("main");
      fill(value: string) {
        (document.querySelector("#name") as HTMLInputElement).value = value;
      }
    }
    registerCompiledPom(
      App,
      manifest("App", [root()], [actionWithParam("fill", "App.fill")])
    );
    const tool = await getPublishedPursueGoal(goalLoop);
    createPageRegistration(App);
    return tool;
  }

  async function registerFailingPom(goalLoop: GoalLoopDecisionFunction) {
    setupDom();
    class App {
      root = page.locator("main");
      fail() {
        throw new Error("action exploded");
      }
    }
    registerCompiledPom(
      App,
      manifest("App", [root()], [action("fail", "App.fail")])
    );
    const tool = await getPublishedPursueGoal(goalLoop);
    createPageRegistration(App);
    return tool;
  }

  // --- Handover reason: done ---

  it("returns done when goal_met >= 0.5 on the first step", async () => {
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.8 }]);
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(withoutChanges(result)).toEqual({
      reason: "done",
      next: expect.stringContaining("achieved"),
      history: [],
    });
  });

  it("returns done after executing an action when goal_met becomes >= 0.5", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.save", goal_met: 0.1 },
      { operation: "none", goal_met: 0.9 },
    ]);
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(result).toMatchObject({
      reason: "done",
      history: [
        {
          operation: "App.save",
          chosen: {},
          result: "ok",
          page_changed: false,
        },
      ],
    });
    expect(clickCount).toBe(1);
  });

  // --- Handover reason: no_fitting_option ---

  it("returns no_fitting_option when the model chooses none", async () => {
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.1 }]);
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "impossible", maxSteps: 5 });
    expect(withoutChanges(result)).toEqual({
      reason: "no_fitting_option",
      next: expect.stringContaining("No available operation"),
      history: [],
    });
  });

  // --- Handover reason: needs_value ---

  it("returns needs_value when chosen tool has required parameters", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.fill", goal_met: 0.1 },
    ]);
    const tool = await registerPomWithParam(decide);
    const result = await tool.execute({
      goal: "fill the name field",
      maxSteps: 5,
    });
    expect(withoutChanges(result)).toEqual({
      reason: "needs_value",
      next: expect.stringContaining("App.fill"),
      history: [],
      needs: { tool: "App.fill", parameters: ["value"] },
    });
  });

  it("offers a Custom Tool as an operation", async () => {
    setupDom();
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "highlight_element",
          goal_met: 0.1,
          arguments: { ref: 'button "Save changes"' },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide, [
      {
        name: "highlight_element",
        description: "Highlight one element on the page.",
        execute: async () => null,
      },
    ]);

    await tool.execute({ goal: "highlight the save button", maxSteps: 5 });

    expect(criteriaOf(requests[0]!).operation!.highlight_element).toBe(
      "Highlight one element on the page."
    );
  });

  it("still hands over for a required free value of a tool that takes a ref", async () => {
    setupDom();
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "fill", goal_met: 0.1 }])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({
      goal: "put a name into the field",
      maxSteps: 5,
    });

    expect(withoutChanges(result)).toEqual({
      reason: "needs_value",
      next: expect.stringContaining("fill"),
      history: [],
      needs: { tool: "fill", parameters: ["target", "text"] },
    });
    // No second request: the loop never asks for a tool it cannot fill.
    expect(requests).toHaveLength(1);
  });

  // --- Goal Values ---

  describe("with Goal Values", () => {
    it("fills a required string parameter with the Goal Value the model picks", async () => {
      setupDom();
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "fill",
            goal_met: 0.1,
            arguments: { target: 'textbox "Name"', text: "item name" },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);

      const result = await tool.execute({
        goal: "Add an item called Milk",
        maxSteps: 5,
        values: { "item name": "Milk", quantity: 2 },
      });

      expect(result).toMatchObject({
        reason: "done",
        history: [
          {
            operation: "fill",
            chosen: {
              text: { key: "item name", description: "item name: Milk" },
            },
            result: "ok",
            did: 'fill(textbox "Name", item name: Milk)',
          },
        ],
      });
      expect((document.querySelector("#name") as HTMLInputElement).value).toBe(
        "Milk"
      );
      // The number is never offered to a string parameter.
      expect(criteriaOf(requests[1]!).text).toEqual({
        "item name": "item name: Milk",
        [NONE_OF_THESE_KEY]: expect.any(String),
      });
      // Both stages are decided on a state that carries the values as passed.
      for (const request of requests)
        expect((request.state as Record<string, unknown>).values).toEqual({
          "item name": "Milk",
          quantity: 2,
        });
    });

    it("offers a Goal Value whose label is __proto__ like any other", async () => {
      setupDom();
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "fill",
            goal_met: 0.1,
            arguments: { target: 'textbox "Name"', text: "__proto__" },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);

      // As JSON from an agent: an own property, not the object's prototype.
      const values: unknown = JSON.parse('{ "__proto__": "Milk" }');
      const result = await tool.execute({
        goal: "Add an item called Milk",
        maxSteps: 5,
        values,
      });

      expect(Object.keys(criteriaOf(requests[1]!).text!)).toEqual([
        "__proto__",
        NONE_OF_THESE_KEY,
      ]);
      expect(result).toMatchObject({
        reason: "done",
        history: [
          {
            chosen: {
              text: { key: "__proto__", description: "__proto__: Milk" },
            },
          },
        ],
      });
      expect((document.querySelector("#name") as HTMLInputElement).value).toBe(
        "Milk"
      );
    });

    it("hands over without asking when no Goal Value fits a required parameter", async () => {
      setupDom();
      const { requests, decide } = recording(
        scriptedDecisionFn([{ operation: "fill", goal_met: 0.1 }])
      );
      const tool = await getPublishedPursueGoal(decide);

      const result = await tool.execute({
        goal: "Add an item called Milk",
        maxSteps: 5,
        values: { quantity: 2 },
      });

      expect(withoutChanges(result)).toEqual({
        reason: "needs_value",
        next: expect.stringMatching(/goal again .* values/),
        history: [],
        needs: { tool: "fill", parameters: ["target", "text"] },
      });
      expect(requests).toHaveLength(1);
    });

    it("hands over, naming the parameter, when the model picks none of the Goal Values", async () => {
      setupDom();
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "fill",
            goal_met: 0.1,
            arguments: { target: 'textbox "Name"', text: NONE_OF_THESE_KEY },
          },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);

      const result = await tool.execute({
        goal: "Add an item called Milk",
        maxSteps: 5,
        values: { "list name": "Groceries" },
      });

      expect(withoutChanges(result)).toEqual({
        reason: "needs_value",
        next: 'The operation "fill" needs a value for "text", and the model judged that none of the Goal Values fits. Call goal again with a value for "text" in values, or call fill directly.',
        history: [],
        needs: { tool: "fill", parameters: ["text"] },
      });
      expect(criteriaOf(requests[1]!).text).toEqual({
        "list name": "list name: Groceries",
        [NONE_OF_THESE_KEY]: expect.any(String),
      });
      expect((document.querySelector("#name") as HTMLInputElement).value).toBe(
        ""
      );
    });

    async function registerSurveyPom(decide: GoalLoopDecisionFunction) {
      setupDom();
      const calls: unknown[][] = [];
      class App {
        root = page.locator("main");
        create(name: string, description?: string) {
          calls.push([name, description]);
        }
      }
      registerCompiledPom(
        App,
        manifest(
          "App",
          [root()],
          [
            actionWithParameters("create", "App.create", [
              { name: "name", optional: false, schema: { type: "string" } },
              {
                name: "description",
                optional: true,
                schema: { type: "string" },
              },
            ]),
          ]
        )
      );
      const tool = await getPublishedPursueGoal(decide);
      createPageRegistration(App);
      return { tool, calls };
    }

    it.each([
      ["fills", "survey description", "Weekly check-in"],
      ["leaves unset", "leave_unset", undefined],
    ])(
      "%s an optional string parameter from the Goal Values",
      async (_, description, expected) => {
        const { requests, decide } = recording(
          scriptedDecisionFn([
            {
              operation: "App.create",
              goal_met: 0.1,
              arguments: { name: "survey name", description },
            },
            { operation: "none", goal_met: 0.9 },
          ])
        );
        const { tool, calls } = await registerSurveyPom(decide);

        await tool.execute({
          goal: "Create a survey called Q4 Feedback",
          maxSteps: 5,
          values: {
            "survey name": "Q4 Feedback",
            "survey description": "Weekly check-in",
          },
        });

        expect(Object.keys(criteriaOf(requests[1]!).description!)).toEqual([
          "survey name",
          "survey description",
          "leave_unset",
        ]);
        expect(calls).toEqual([["Q4 Feedback", expected]]);
      }
    );

    it("leaves an optional parameter unset without asking when no Goal Value fits", async () => {
      setupDom();
      const calls: unknown[][] = [];
      class App {
        root = page.locator("main");
        rate(name: string, stars?: number) {
          calls.push([name, stars]);
        }
      }
      registerCompiledPom(
        App,
        manifest(
          "App",
          [root()],
          [
            actionWithParameters("rate", "App.rate", [
              { name: "name", optional: false, schema: { type: "string" } },
              { name: "stars", optional: true, schema: { type: "integer" } },
            ]),
          ]
        )
      );
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "App.rate",
            goal_met: 0.1,
            arguments: { name: "survey name" },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);
      createPageRegistration(App);

      await tool.execute({
        goal: "Rate the Q4 Feedback survey",
        maxSteps: 5,
        values: { "survey name": "Q4 Feedback", score: 4.5 },
      });

      expect(Object.keys(criteriaOf(requests[1]!))).toEqual(["name"]);
      expect(calls).toEqual([["Q4 Feedback", undefined]]);
    });

    it("offers a number parameter any number and an integer parameter whole numbers only", async () => {
      setupDom();
      const calls: unknown[][] = [];
      class App {
        root = page.locator("main");
        order(quantity: number, price: number) {
          calls.push([quantity, price]);
        }
      }
      registerCompiledPom(
        App,
        manifest(
          "App",
          [root()],
          [
            actionWithParameters("order", "App.order", [
              {
                name: "quantity",
                optional: false,
                schema: { type: "integer" },
              },
              { name: "price", optional: false, schema: { type: "number" } },
            ]),
          ]
        )
      );
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "App.order",
            goal_met: 0.1,
            arguments: { quantity: "count", price: "price" },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);
      createPageRegistration(App);

      await tool.execute({
        goal: "Order three at 2.5 each",
        maxSteps: 5,
        values: { product: "Milk", count: 3, price: 2.5 },
      });

      const stageTwo = criteriaOf(requests[1]!);
      expect(Object.keys(stageTwo.quantity!)).toEqual([
        "count",
        NONE_OF_THESE_KEY,
      ]);
      expect(Object.keys(stageTwo.price!)).toEqual([
        "count",
        "price",
        NONE_OF_THESE_KEY,
      ]);
      expect(calls).toEqual([[3, 2.5]]);
    });

    function setupSelect(multiple: boolean) {
      document.body.innerHTML = `
        <main>
          <label>Tags
            <select id="tags" ${multiple ? "multiple" : ""}>
              <option>urgent</option>
              <option>billing</option>
              <option>spam</option>
            </select>
          </label>
        </main>
      `;
      return document.querySelector("#tags") as HTMLSelectElement;
    }

    const selected = (select: HTMLSelectElement) =>
      Array.from(select.selectedOptions, (option) => option.value);

    const TAGS = { first: "urgent", second: "billing", third: "spam" };

    it("fills a list parameter with every Goal Value the model includes, in map order", async () => {
      const select = setupSelect(true);
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "select_option",
            goal_met: 0.1,
            arguments: {
              target: 'listbox "Tags"',
              [optionValueQuestion(1)]: { noul: 0.6 },
              [optionValueQuestion(2)]: { noul: 0.2 },
              [optionValueQuestion(3)]: { noul: 0.9 },
            },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);

      const result = await tool.execute({
        goal: "Tag it as urgent and spam",
        maxSteps: 5,
        values: { ...TAGS, count: 2 },
      });

      // One noul per string Goal Value, in the same request as the target.
      const questions = requests[1]!.questions as Record<
        string,
        { type: string; instructions: string }
      >;
      expect(Object.keys(questions)).toEqual([
        "target",
        optionValueQuestion(1),
        optionValueQuestion(2),
        optionValueQuestion(3),
      ]);
      expect(questions[optionValueQuestion(2)]).toEqual({
        type: "noul",
        instructions: expect.stringContaining('"second: billing"'),
      });
      expect(selected(select)).toEqual(["urgent", "spam"]);
      expect(result).toMatchObject({
        reason: "done",
        history: [
          {
            operation: "select_option",
            chosen: {
              values: {
                key: "first, third",
                description: "first: urgent, third: spam",
              },
            },
          },
        ],
      });
    });

    it("sends a single select only the Goal Value the model scored highest", async () => {
      const select = setupSelect(false);
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "select_option",
            goal_met: 0.1,
            arguments: {
              target: 'combobox "Tags"',
              [optionValueQuestion(1)]: { noul: 0.6 },
              [optionValueQuestion(2)]: { noul: 0.95 },
              [optionValueQuestion(3)]: { noul: 0.7 },
            },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);

      const result = await tool.execute({
        goal: "Tag it as billing",
        maxSteps: 5,
        values: TAGS,
      });

      expect(selected(select)).toEqual(["billing"]);
      // The target and one noul per Goal Value, in one stage-two request.
      expect(questionTypesOf(requests[1]!)).toEqual({
        target: "choice",
        [optionValueQuestion(1)]: "noul",
        [optionValueQuestion(2)]: "noul",
        [optionValueQuestion(3)]: "noul",
      });
      expect(result).toMatchObject({
        history: [
          {
            chosen: {
              values: { key: "second", description: "second: billing" },
            },
          },
        ],
      });
    });

    it("hands over when the model includes no Goal Value in a required list", async () => {
      const select = setupSelect(true);
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "select_option",
            goal_met: 0.1,
            arguments: {
              target: 'listbox "Tags"',
              [optionValueQuestion(1)]: { noul: 0.1 },
              [optionValueQuestion(2)]: { noul: 0.4 },
              [optionValueQuestion(3)]: { noul: 0.2 },
            },
          },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);

      const result = await tool.execute({
        goal: "Tag it as important",
        maxSteps: 5,
        values: TAGS,
      });

      expect(withoutChanges(result)).toEqual({
        reason: "needs_value",
        next: expect.stringContaining(
          'Call goal again with a value for "values" in values'
        ),
        history: [],
        needs: { tool: "select_option", parameters: ["values"] },
      });
      expect(selected(select)).toEqual([]);
      expect(requests).toHaveLength(2);
      // The target and one noul per Goal Value, in one stage-two request.
      expect(questionTypesOf(requests[1]!)).toEqual({
        target: "choice",
        [optionValueQuestion(1)]: "noul",
        [optionValueQuestion(2)]: "noul",
        [optionValueQuestion(3)]: "noul",
      });
    });

    it("leaves an optional list unset when the model includes no Goal Value", async () => {
      setupDom();
      const calls: unknown[] = [];
      class App {
        root = page.locator("main");
        tag(labels?: string[]) {
          calls.push(labels);
        }
      }
      registerCompiledPom(
        App,
        manifest(
          "App",
          [root()],
          [
            actionWithParameters("tag", "App.tag", [
              {
                name: "labels",
                optional: true,
                schema: { type: "array", items: { type: "string" } },
              },
            ]),
          ]
        )
      );
      const { requests, decide } = recording(
        scriptedDecisionFn([
          {
            operation: "App.tag",
            goal_met: 0.1,
            arguments: {
              [listValueQuestionId("labels", 1, ["labels"])]: { noul: 0.3 },
            },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      );
      const tool = await getPublishedPursueGoal(decide);
      createPageRegistration(App);

      const result = await tool.execute({
        goal: "Tag it",
        maxSteps: 5,
        values: { label: "urgent" },
      });

      expect(questionTypesOf(requests[1]!)).toEqual({
        [listValueQuestionId("labels", 1, ["labels"])]: "noul",
      });
      expect(calls).toEqual([undefined]);
      expect(result).toMatchObject({
        reason: "done",
        history: [{ operation: "App.tag", chosen: {}, did: "App.tag()" }],
      });
    });

    it("runs without Goal Values when values is undefined", async () => {
      const { requests, decide } = recording(
        scriptedDecisionFn([{ operation: "none", goal_met: 0.9 }])
      );
      const tool = await registerPom(decide);

      await expect(
        tool.execute({ goal: "save changes", maxSteps: 5, values: undefined })
      ).resolves.toMatchObject({ reason: "done" });
      expect(requests[0]!.state).not.toHaveProperty("values");
    });

    it.each([
      ["an empty map", {}],
      [
        "more than 254 values",
        Object.fromEntries(
          Array.from({ length: 255 }, (_, index) => [`v${index}`, index])
        ),
      ],
      ["a boolean value", { confirm: true }],
      ["an object value", { item: { name: "Milk" } }],
      ["a list of values", ["Milk"]],
    ])(
      "refuses %s as invalid input before the loop starts",
      async (_, values) => {
        const { requests, decide } = recording(scriptedDecisionFn([]));
        const tool = await registerPom(decide);

        expect(
          await tool
            .execute({ goal: "Add Milk", maxSteps: 5, values })
            .catch(errorText)
        ).toMatch(/^ToolInputError: .*values/);
        expect(requests).toEqual([]);
      }
    );
  });

  // --- Handover reason: action_failed ---

  it("returns action_failed after two consecutive failures", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.fail", goal_met: 0.1 },
      { operation: "App.fail", goal_met: 0.1 },
    ]);
    const tool = await registerFailingPom(decide);
    const result = await tool.execute({ goal: "do the thing", maxSteps: 5 });
    expect(result).toMatchObject({
      reason: "action_failed",
      history: [
        {
          operation: "App.fail",
          result: "action exploded",
          page_changed: false,
        },
        {
          operation: "App.fail",
          result: "action exploded",
          page_changed: false,
        },
      ],
    });
    expect((result as Record<string, unknown>).next).toContain(
      "Two operations failed"
    );
  });

  it("returns invalid goal input as a ToolInputError result", async () => {
    const decide = scriptedDecisionFn([]);
    const tool = await registerPom(decide);

    expect(
      await tool.execute({ goal: "do the thing" }).catch(errorText)
    ).toMatch(/^ToolInputError: .*maxSteps/);
  });

  // --- Handover reason: step_budget ---

  it("returns step_budget when maxSteps is exhausted", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.save", goal_met: 0.1 },
      { operation: "App.save", goal_met: 0.2 },
    ]);
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "save many times", maxSteps: 2 });
    expect(result).toMatchObject({
      reason: "step_budget",
      history: [
        { operation: "App.save", result: "ok", page_changed: false },
        { operation: "App.save", result: "ok", page_changed: false },
      ],
    });
    expect(clickCount).toBe(2);
  });

  // --- Handover reason: decide_failed ---

  it("returns decide_failed when the decision function throws", async () => {
    const decide = failingDecisionFn(new Error("network error"));
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(withoutChanges(result)).toEqual({
      reason: "decide_failed",
      next: expect.stringContaining("network error"),
      history: [],
    });
  });

  it("returns decide_failed when goal_met is not a finite number", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.save", goal_met: Infinity },
    ]);
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(withoutChanges(result)).toEqual({
      reason: "decide_failed",
      next: expect.stringContaining("Invalid goal_met answer"),
      history: [],
    });
  });

  // --- Order of checks ---

  it("checks done before no_fitting_option (goal_met >= 0.5 wins over none)", async () => {
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.5 }]);
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "already done", maxSteps: 5 });
    expect((result as Record<string, unknown>).reason).toBe("done");
  });

  it("checks no_fitting_option before needs_value", async () => {
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.1 }]);
    const tool = await registerPomWithParam(decide);
    const result = await tool.execute({ goal: "something", maxSteps: 5 });
    expect((result as Record<string, unknown>).reason).toBe(
      "no_fitting_option"
    );
  });

  /** POM with save (no params), fail (throws), and fill (with param). */
  async function registerCombinedPom(goalLoop: GoalLoopDecisionFunction) {
    setupDom();
    class App {
      root = page.locator("main");
      save() {
        (document.querySelector("#save") as HTMLButtonElement).click();
      }
      fail() {
        throw new Error("action exploded");
      }
      fill(value: string) {
        (document.querySelector("#name") as HTMLInputElement).value = value;
      }
    }
    registerCompiledPom(
      App,
      manifest(
        "App",
        [root()],
        [
          action("save", "App.save"),
          action("fail", "App.fail"),
          actionWithParam("fill", "App.fill"),
        ]
      )
    );
    const tool = await getPublishedPursueGoal(goalLoop);
    createPageRegistration(App);
    return tool;
  }

  it("checks needs_value before action_failed", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.fail", goal_met: 0.1 },
      { operation: "App.fill", goal_met: 0.1 },
    ]);
    const tool = await registerCombinedPom(decide);
    const result = await tool.execute({ goal: "do something", maxSteps: 5 });
    expect((result as Record<string, unknown>).reason).toBe("needs_value");
    expect((result as Record<string, unknown>).needs).toEqual({
      tool: "App.fill",
      parameters: ["value"],
    });
  });

  it("resets consecutive failure count after a successful action", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.fail", goal_met: 0.1 },
      { operation: "App.save", goal_met: 0.1 },
      { operation: "App.fail", goal_met: 0.1 },
    ]);
    const tool = await registerCombinedPom(decide);
    const result = await tool.execute({ goal: "try hard", maxSteps: 3 });
    expect((result as Record<string, unknown>).reason).toBe("step_budget");
  });

  // --- History contents ---

  it("records the operation, ok results, and page_changed in history", async () => {
    document.body.innerHTML = `
      <main>
        <button id="save">Save changes</button>
      </main>
    `;
    document.querySelector("#save")!.addEventListener("click", () => {
      clickCount++;
      const banner = document.createElement("div");
      banner.setAttribute("role", "alert");
      banner.textContent = "Changes saved";
      document.querySelector("main")!.appendChild(banner);
    });
    class App {
      root = page.locator("main");
      save() {
        (document.querySelector("#save") as HTMLButtonElement).click();
      }
    }
    registerCompiledPom(
      App,
      manifest("App", [root()], [action("save", "App.save")])
    );
    const decide = scriptedDecisionFn([
      { operation: "App.save", goal_met: 0.1 },
      { operation: "none", goal_met: 0.9 },
    ]);
    const tool = await getPublishedPursueGoal(decide);
    createPageRegistration(App);
    const result = (await tool.execute({
      goal: "save",
      maxSteps: 5,
    })) as Record<string, unknown>;
    expect(result.reason).toBe("done");
    const history = result.history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history).toEqual([
      {
        operation: "App.save",
        chosen: {},
        result: "ok",
        page_changed: true,
        did: expect.any(String),
      },
    ]);
  });

  it("records a failed step as a bare step record with the error as its result", async () => {
    const { requests, decide } = recording(
      scriptedDecisionFn([
        { operation: "App.fail", goal_met: 0.1 },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await registerFailingPom(decide);
    const result = (await tool.execute({
      goal: "do the thing",
      maxSteps: 5,
    })) as Record<string, unknown>;
    const record = {
      operation: "App.fail",
      chosen: {},
      result: "action exploded",
      page_changed: false,
      did: "App.fail()",
    };
    expect(result.reason).toBe("done");
    expect(result.history).toEqual([record]);
    // The next step's model state carries the same entry, and nothing more.
    expect((requests.at(-1)!.state as Record<string, unknown>).history).toEqual(
      [record]
    );
  });

  // --- State fields sent to the model ---

  it("sends goal, page (typed tree), page_objects, and history as state fields", async () => {
    let capturedRequest: DecisionRequest | undefined;
    const decide: GoalLoopDecisionFunction = async (request) => {
      capturedRequest = request;
      const criteria =
        (
          request.questions as Record<
            string,
            { criteria?: Record<string, string> }
          >
        ).operation?.criteria ?? {};
      const probabilities: Record<string, number> = {};
      for (const key of Object.keys(criteria)) {
        probabilities[key] = key === "none" ? 1 : 0;
      }
      return {
        model: "typesafe/jev-1.13",
        answers: {
          operation: {
            type: "choice",
            choice: "none",
            confidence: 1,
            probabilities,
          },
          goal_met: { type: "noul", noul: 0.9 },
        },
      };
    };
    const tool = await registerPom(decide);
    await tool.execute({ goal: "test state fields", maxSteps: 5 });

    expect(capturedRequest).toBeDefined();
    const state = capturedRequest!.state as Record<string, unknown>;
    expect(state.goal).toBe("test state fields");
    // page is the typed structural tree (JSON array), not rendered text
    expect(Array.isArray(state.page)).toBe(true);
    expect((state.page as unknown[]).length).toBeGreaterThan(0);
    expect(typeof state.page_objects).toBe("string");
    expect(state.history).toEqual([]);

    const questions = capturedRequest!.questions as Record<string, unknown>;
    expect(questions.operation).toMatchObject({ type: "choice" });
    expect(questions.goal_met).toMatchObject({ type: "noul" });
  });

  // --- Internal run result ---

  it("retains per-step scores in the internal run result", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.save", goal_met: 0.1 },
      { operation: "none", goal_met: 0.9 },
    ]);
    const tool = await registerPom(decide);
    await tool.execute({ goal: "save and done", maxSteps: 5 });

    const runResult = getLastGoalLoopRunResult();
    expect(runResult).toBeDefined();
    expect(runResult!.stepScores).toHaveLength(2);
    expect(runResult!.stepScores[0]!.goalMetScore).toBe(0.1);
    expect(runResult!.stepScores[1]!.goalMetScore).toBe(0.9);
    expect(runResult!.stepScores[0]!.operationProbabilities).toBeDefined();
    expect(runResult!.handover.reason).toBe("done");
  });

  // --- Stage two: the model fills closed-set arguments ---

  /** A page with one clickable element among elements click cannot use. */
  function setupPageWithOneClickable() {
    document.body.innerHTML = `
      <main>
        <h1>Task list</h1>
        <p>Two tasks are open.</p>
        <button id="save">Save changes</button>
        <button id="locked" disabled>Locked</button>
      </main>
    `;
    document.querySelector("#save")!.addEventListener("click", () => {
      clickCount++;
    });
  }

  /** Every ref the page state sent to the model contains. */
  function refsInPage(state: unknown): string[] {
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (typeof record.ref === "string") refs.push(record.ref);
      walk(record.children);
    };
    walk((state as Record<string, unknown>).page);
    return refs;
  }

  it("asks for a ref over click's filtered options and clicks the chosen one", async () => {
    setupPageWithOneClickable();
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "click",
          goal_met: 0.1,
          arguments: { target: 'button "Save changes"' },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = (await tool.execute({
      goal: "save the changes",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // Only the element click's built-in filter keeps is offered.
    const [[key, description], ...rest] = Object.entries(
      criteriaOf(requests[1]!).target!
    );
    expect(rest).toEqual([]);
    // Options carry the node's ref as their key, as the page state labels it,
    // and its role and name so the model can tell options apart.
    expect(refsInPage(requests[1]!.state)).toContain(key);
    expect(description).toContain("button");
    expect(description).toContain("Save changes");
    expect(clickCount).toBe(1);
    expect(result.reason).toBe("done");
    // The step record names the tool and the option chosen, as offered.
    const record = {
      operation: "click",
      chosen: { target: { key, description } },
      result: "ok",
      // Whether a click changes the page (focus among others) is the
      // interaction history's promise, pinned in its own tests.
      page_changed: expect.any(Boolean),
      did: expect.any(String),
    };
    expect(description).toBe('button "Save changes"');
    expect(result.history).toEqual([record]);
    // The next step's state, as sent, carries the same record, and the run
    // result's step is built on it.
    expect((requests[2]!.state as Record<string, unknown>).history).toEqual([
      record,
    ]);
    expect(getLastGoalLoopRunResult()!.stepScores[0]).toMatchObject(record);
  });

  it("offers a single-element tool with a filter only the elements it keeps", async () => {
    setupPageWithOneClickable();
    const highlighted: { ref: string; tagName: string }[] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "highlight_element",
          goal_met: 0.1,
          arguments: { ref: 'heading "Task list"' },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide, [
      {
        name: "highlight_element",
        description: "Highlight one element on the page.",
        filter: (element) => element.tagName === "H1",
        execute: async ({ ref, element }) => {
          highlighted.push({ ref, tagName: element.tagName });
        },
      },
    ]);

    await tool.execute({ goal: "highlight the title", maxSteps: 5 });

    const refQuestion = criteriaOf(requests[1]!).ref!;
    expect(Object.keys(refQuestion)).toHaveLength(1);
    expect(Object.values(refQuestion)[0]).toContain("Task list");
    expect(highlighted).toEqual([
      { ref: Object.keys(refQuestion)[0], tagName: "H1" },
    ]);
  });

  it("offers a single-element tool without a filter every node that has a ref", async () => {
    setupPageWithOneClickable();
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "highlight_element",
          goal_met: 0.1,
          arguments: { ref: 'heading "Task list"' },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide, [
      {
        name: "highlight_element",
        description: "Highlight one element on the page.",
        execute: async () => null,
      },
    ]);

    await tool.execute({ goal: "highlight something", maxSteps: 5 });

    const descriptions = Object.values(criteriaOf(requests[1]!).ref!);
    const offers = (name: string) =>
      descriptions.some((description) => description.includes(name));
    expect(offers("Task list")).toBe(true);
    expect(offers("Save changes")).toBe(true);
    // Nodes click would never offer — a disabled button and a text paragraph.
    expect(offers("Locked")).toBe(true);
    expect(offers("paragraph")).toBe(true);
  });

  // --- The page the model reads is pruned; the options are not ---

  it("prunes ref-only wrappers and text leaves from the page it sends, and every option still resolves", async () => {
    document.body.innerHTML = `
      <main>
        <div id="outer">
          <div id="inner">
            <button id="save">Save changes</button>
            <button id="other">Other</button>
          </div>
          <section aria-label="Word"><div>T</div><div>a</div><div>s</div><div>k</div></section>
        </div>
      </main>
    `;
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "highlight_element",
          goal_met: 0.1,
          arguments: { ref: 'button "Save changes"' },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    // A single-element tool without a filter is offered every node of the full capture.
    const tool = await getPublishedPursueGoal(decide, [
      {
        name: "highlight_element",
        description: "Highlight one element on the page.",
        execute: async () => null,
      },
    ]);

    await tool.execute({ goal: "highlight the save button", maxSteps: 5 });

    const offered = criteriaOf(requests[1]!).ref!;
    const wrapperRefs = Object.keys(offered).filter(
      (ref) => offered[ref] === "generic"
    );
    const buttonRef = Object.keys(offered).find(
      (ref) => offered[ref] === 'button "Save changes"'
    );
    expect(wrapperRefs.length).toBeGreaterThan(0);
    expect(buttonRef).toBeDefined();

    // The page sent holds the button but none of the wrappers, and the text
    // of the single-character leaves hoisted, each string as it was.
    const page = requests[1]!.state as { page: unknown };
    const refs = refsInPage(page);
    expect(refs).toContain(buttonRef);
    for (const ref of wrapperRefs) expect(refs).not.toContain(ref);
    // Block leaves: the capture keeps each as a generic of its own, unlike
    // inline text, which it folds into the parent before Ayme sees it.
    const regions: unknown[][] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const record = node as { role?: string; children?: unknown[] };
      if (record.role === "region") regions.push(record.children ?? []);
      walk(record.children);
    };
    walk(page.page);
    expect(regions).toEqual([["T", "a", "s", "k"]]);

    // Every option, wrappers included, resolves in the full capture.
    const resolutions = await resolvePageStateRefs(
      document,
      ...Object.keys(offered).map((ref) => AriaRefSchema.parse(ref))
    );
    expect(resolutions.map((resolution) => resolution.status)).toEqual(
      Object.keys(offered).map(() => "resolved")
    );
    expect(
      resolutions.map(
        (resolution) =>
          resolution.status === "resolved" &&
          resolution.node.element instanceof Element
      )
    ).not.toContain(false);
  });

  // --- Stage two: a ref question over the option cap ---

  /** A page whose clickable elements outnumber one question's options. */
  function setupPageWithManyClickables(count: number): string[] {
    document.body.innerHTML = `<main>${Array.from(
      { length: count },
      (_, index) => `<button>Item ${index}</button>`
    ).join("")}</main>`;
    const clicked: string[] = [];
    document.querySelector("main")!.addEventListener("click", (event) => {
      clicked.push((event.target as HTMLElement).textContent ?? "");
    });
    return clicked;
  }

  /** The refs a chunk question offers: every option but "none of these". */
  function refsOffered(criteria: Criteria): string[] {
    return Object.keys(criteria).filter((key) => key !== NONE_OF_THESE_KEY);
  }

  it("asks for a ref in document-order chunks when the page holds more elements than one question offers", async () => {
    const clicked = setupPageWithManyClickables(300);
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "click",
          goal_met: 0.1,
          arguments: { target: 'button "Item 299"' },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = (await tool.execute({
      goal: "click the last item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // The one stage-two request carries ⌈300 / 254⌉ = 2 chunk questions, all
    // for the `ref` parameter.
    const stageTwo = criteriaOf(requests[1]!);
    expect(Object.keys(stageTwo)).toEqual([
      chunkQuestionId("target", 1, CLICK_PARAMETERS),
      chunkQuestionId("target", 2, CLICK_PARAMETERS),
    ]);
    const chunks = Object.values(stageTwo);
    for (const chunk of chunks) {
      expect(refsOffered(chunk).length).toBeLessThanOrEqual(254);
      expect(Object.keys(chunk).length).toBeLessThanOrEqual(255);
      expect(Object.keys(chunk).at(-1)).toBe(NONE_OF_THESE_KEY);
    }
    // Together the chunks hold every clickable element exactly once, in the
    // order the page state lists them.
    const offered = chunks.flatMap(refsOffered);
    expect(offered).toHaveLength(300);
    expect(new Set(offered).size).toBe(300);
    const offeredSet = new Set(offered);
    expect(
      refsInPage(requests[1]!.state).filter((ref) => offeredSet.has(ref))
    ).toEqual(offered);
    // The one chunk that named an element decides; no further request follows
    // before the next step's stage one.
    expect(requests).toHaveLength(3);
    expect(clicked).toEqual(["Item 299"]);
    expect(result.reason).toBe("done");
    expect(result.history).toMatchObject([
      {
        operation: "click",
        chosen: {
          target: { key: expect.any(String), description: 'button "Item 299"' },
        },
        result: "ok",
      },
    ]);
    // Each chunk's answer is recorded in the step's scores.
    const score =
      getLastGoalLoopRunResult()!.stepScores[0]!.argumentProbabilities!;
    expect(Object.keys(score)).toEqual(Object.keys(stageTwo));
  });

  it("asks one run-off among exactly the elements several chunks named", async () => {
    const clicked = setupPageWithManyClickables(300);
    const runOffId = runOffQuestionId("target", CLICK_PARAMETERS);
    // The decision function answers stage two without the optional
    // probabilities: the chosen keys are recorded all the same.
    const { requests, decide } = recording(
      withoutArgumentProbabilities(
        scriptedDecisionFn([
          {
            operation: "click",
            goal_met: 0.1,
            arguments: {
              target: ['button "Item 3"', 'button "Item 299"'],
              [runOffId]: 'button "Item 299"',
            },
          },
          { operation: "none", goal_met: 0.9 },
        ])
      )
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = (await tool.execute({
      goal: "click the last item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // Stage one, stage two, the run-off, then the next step's stage one.
    expect(requests).toHaveLength(4);
    const stageTwo = criteriaOf(requests[1]!);
    const [firstChunk, secondChunk] = Object.values(stageTwo);
    const named = [
      keyFor(firstChunk!, 'button "Item 3"'),
      keyFor(secondChunk!, 'button "Item 299"'),
    ];
    const runOff = criteriaOf(requests[2]!);
    expect(Object.keys(runOff)).toEqual([runOffId]);
    expect(Object.keys(runOff[runOffId]!)).toEqual(named);
    expect(clicked).toEqual(["Item 299"]);
    expect(result.reason).toBe("done");
    // Each chunk's chosen key and the run-off's are recorded.
    const [firstChunkId, secondChunkId] = Object.keys(stageTwo);
    const score = getLastGoalLoopRunResult()!.stepScores[0]!;
    expect(score.argumentChoices).toEqual({
      [firstChunkId!]: named[0],
      [secondChunkId!]: named[1],
      [runOffId]: named[1],
    });
    expect(score.argumentProbabilities).toEqual({});
  });

  it("keeps the chunks' choices on the run result when the run-off answer is invalid", async () => {
    const clicked = setupPageWithManyClickables(300);
    const runOffId = runOffQuestionId("target", CLICK_PARAMETERS);
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "click",
          goal_met: 0.1,
          arguments: {
            target: ['button "Item 3"', 'button "Item 299"'],
            [runOffId]: { raw: "e999" },
          },
        },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = (await tool.execute({
      goal: "click the last item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    expect(result.reason).toBe("decide_failed");
    expect(clicked).toEqual([]);
    const stageTwo = criteriaOf(requests[1]!);
    const [firstChunkId, secondChunkId] = Object.keys(stageTwo);
    const score = getLastGoalLoopRunResult()!.stepScores[0]!;
    // Both chunks named an element; the run-off's answer is not recorded.
    expect(score.argumentChoices).toEqual({
      [firstChunkId!]: keyFor(stageTwo[firstChunkId!]!, 'button "Item 3"'),
      [secondChunkId!]: keyFor(stageTwo[secondChunkId!]!, 'button "Item 299"'),
    });
    expect(Object.keys(score.argumentProbabilities!)).toEqual([
      firstChunkId,
      secondChunkId,
    ]);
  });

  it("hands over with no_fitting_option when every chunk answers none of these", async () => {
    const clicked = setupPageWithManyClickables(300);
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "click",
          goal_met: 0.1,
          arguments: { target: [] },
        },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({
      goal: "click the missing item",
      maxSteps: 5,
    });

    expect(withoutChanges(result)).toEqual({
      reason: "no_fitting_option",
      next: expect.stringContaining('"click"'),
      // The step ran no action, so it leaves no history entry.
      history: [],
    });
    expect(requests).toHaveLength(2);
    expect(clicked).toEqual([]);
    // The chunk answers are still scored.
    const stageTwo = criteriaOf(requests[1]!);
    const score =
      getLastGoalLoopRunResult()!.stepScores[0]!.argumentProbabilities!;
    expect(Object.keys(score)).toEqual(Object.keys(stageTwo));
    for (const id of Object.keys(stageTwo))
      expect(score[id]![NONE_OF_THESE_KEY]).toBe(1);
    expect(getLastGoalLoopRunResult()!.stepScores[0]!.argumentChoices).toEqual(
      Object.fromEntries(
        Object.keys(stageTwo).map((id) => [id, NONE_OF_THESE_KEY])
      )
    );
  });

  it("hands over when no element on the page fits the chosen operation", async () => {
    document.body.innerHTML = `<main><p>Nothing to do here.</p></main>`;
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "click", goal_met: 0.1 }])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({ goal: "click something", maxSteps: 5 });

    expect(result).toMatchObject({
      reason: "needs_value",
      needs: { tool: "click", parameters: ["target"] },
    });
    expect(requests).toHaveLength(1);
  });

  it("asks enum and boolean parameters of one tool in a single request", async () => {
    setupDom();
    const calls: unknown[][] = [];
    class App {
      root = page.locator("main");
      configure(mode: string, confirm: boolean) {
        calls.push([mode, confirm]);
      }
    }
    registerCompiledPom(
      App,
      manifest(
        "App",
        [root()],
        [
          actionWithParameters("configure", "App.configure", [
            {
              name: "mode",
              optional: false,
              schema: { type: "string", enum: ["compact", "full"] },
            },
            { name: "confirm", optional: false, schema: { type: "boolean" } },
          ]),
        ]
      )
    );
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "App.configure",
          goal_met: 0.1,
          arguments: { mode: "full", confirm: "true" },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);
    createPageRegistration(App);

    const result = (await tool.execute({
      goal: "configure the app",
      maxSteps: 5,
    })) as Record<string, unknown>;

    const stageTwo = criteriaOf(requests[1]!);
    expect(Object.keys(stageTwo)).toEqual(["mode", "confirm"]);
    expect(Object.keys(stageTwo.mode!)).toEqual(["compact", "full"]);
    expect(Object.keys(stageTwo.confirm!)).toEqual(["true", "false"]);
    expect(calls).toEqual([["full", true]]);
    // `did` is derived: the operation and the chosen options' descriptions.
    expect(result.history).toEqual([
      {
        operation: "App.configure",
        chosen: {
          mode: { key: "full", description: "full" },
          confirm: { key: "true", description: "true" },
        },
        result: "ok",
        page_changed: false,
        did: "App.configure(full, true)",
      },
    ]);
  });

  it("offers an optional closed-set parameter a leave-unset choice", async () => {
    setupDom();
    const calls: unknown[][] = [];
    class App {
      root = page.locator("main");
      sort(order?: string) {
        calls.push([order]);
      }
    }
    registerCompiledPom(
      App,
      manifest(
        "App",
        [root()],
        [
          actionWithParameters("sort", "App.sort", [
            {
              name: "order",
              optional: true,
              schema: { type: "string", enum: ["asc", "desc"] },
            },
          ]),
        ]
      )
    );
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "App.sort",
          goal_met: 0.1,
          arguments: { order: "leave_unset" },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);
    createPageRegistration(App);

    const result = (await tool.execute({
      goal: "sort the list",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // The enum's own values, plus one more choice that leaves it unset.
    const offered = criteriaOf(requests[1]!).order!;
    expect(Object.keys(offered)).toEqual(["asc", "desc", "leave_unset"]);
    expect(calls).toEqual([[undefined]]);
    // The history says the parameter was left unset on purpose.
    expect(result.history).toMatchObject([
      {
        operation: "App.sort",
        chosen: {
          order: { key: "leave_unset", description: offered.leave_unset },
        },
      },
    ]);
  });

  it("records the scores of stage two per step in the internal run result", async () => {
    setupPageWithOneClickable();
    const decide = scriptedDecisionFn([
      {
        operation: "click",
        goal_met: 0.1,
        arguments: { target: 'button "Save changes"' },
      },
      { operation: "none", goal_met: 0.9 },
    ]);
    const tool = await getPublishedPursueGoal(decide);

    await tool.execute({ goal: "save the changes", maxSteps: 5 });

    const runResult = getLastGoalLoopRunResult();
    const probabilities = runResult!.stepScores[0]!.argumentProbabilities;
    expect(probabilities).toBeDefined();
    expect(Object.values(probabilities!.target!)).toContain(1);
    expect(runResult!.stepScores[1]!.argumentProbabilities).toBeUndefined();
  });

  it("ends the run when the model answers outside the offered options", async () => {
    setupPageWithOneClickable();
    const decide = scriptedDecisionFn([
      {
        operation: "click",
        goal_met: 0.1,
        arguments: { target: { raw: "e999" } },
      },
    ]);
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({
      goal: "save the changes",
      maxSteps: 5,
    });

    expect(withoutChanges(result)).toEqual({
      reason: "decide_failed",
      // The answer the loop could not use is named in plain words.
      next: expect.stringContaining("e999"),
      history: [],
    });
    expect(clickCount).toBe(0);
  });

  // --- Stage two: which instance of a collection ---

  /** A list of `count` items, each the root of one collection instance. */
  function setupCollectionDom(count: number) {
    document.body.innerHTML = `
      <main>
        <ul>
          ${Array.from(
            { length: count },
            (_, index) =>
              `<li id="item-${index}" aria-label="Item ${index}">Item ${index}</li>`
          ).join("")}
        </ul>
      </main>
    `;
  }

  /**
   * A POM whose `items` collection carries one action. `itemTools` are the
   * action manifests, `itemMembers` the methods each instance answers with.
   */
  async function registerItemsPom(
    goalLoop: GoalLoopDecisionFunction,
    count: number,
    itemTools: ToolManifest[],
    itemMembers: (index: number) => Record<string, unknown>
  ) {
    setupCollectionDom(count);
    class ItemsPage {
      readonly items = Array.from({ length: count }, (_, index) => ({
        root: page.locator(`#item-${index}`),
        ...itemMembers(index),
      }));
    }
    registerCompiledPom(
      ItemsPage,
      manifest(
        "ItemsPage",
        [collection("items", "Item")],
        [],
        [{ className: "Item", members: [root()], tools: itemTools }]
      )
    );
    const tool = await getPublishedPursueGoal(goalLoop);
    createPageRegistration(ItemsPage);
    return tool;
  }

  it("asks which instance of a collection to act on and runs the action on it", async () => {
    const archived: number[] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "ItemsPage.items.archive",
          goal_met: 0.1,
          arguments: { ref: "ItemsPage.items[1]" },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await registerItemsPom(
      decide,
      3,
      [action("archive", "archive")],
      (index) => ({ archive: () => archived.push(index) })
    );

    const result = (await tool.execute({
      goal: "archive the second item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // One question, over the present roots of the tool's collection path.
    const stageTwo = criteriaOf(requests[1]!);
    expect(Object.keys(stageTwo)).toEqual(["ref"]);
    const descriptions = Object.values(stageTwo.ref!);
    expect(descriptions).toHaveLength(3);
    descriptions.forEach((description, index) => {
      // Label, role and name: what tells one instance from another.
      expect(description).toContain(`ItemsPage.items[${index}]`);
      expect(description).toContain("listitem");
      expect(description).toContain(`Item ${index}`);
    });
    // The option keys are the refs the page state gave the model.
    expect(refsInPage(requests[1]!.state)).toEqual(
      expect.arrayContaining(Object.keys(stageTwo.ref!))
    );
    expect(archived).toEqual([1]);
    expect(result.reason).toBe("done");
    // The step record names the qualified tool and the instance chosen, as
    // offered.
    const [chosenKey, chosenDescription] = Object.entries(stageTwo.ref!)[1]!;
    const record = {
      operation: "ItemsPage.items.archive",
      chosen: {
        ref: { key: chosenKey, description: chosenDescription },
      },
      result: "ok",
      page_changed: false,
      did: expect.any(String),
    };
    expect(result.history).toEqual([record]);
    expect((requests[2]!.state as Record<string, unknown>).history).toEqual([
      record,
    ]);
    expect(getLastGoalLoopRunResult()!.stepScores[0]).toMatchObject(record);
  });

  it("keeps the full capture behind the instance options and the Change Record while the page it sends is pruned", async () => {
    // Items under wrappers the model is not shown, with text leaves inside;
    // the wrappers hold two children each so the capture keeps them as nodes
    // of their own.
    const count = 3;
    document.body.innerHTML = `
      <main>
        <div>
          <ul>
            ${Array.from(
              { length: count },
              (_, index) =>
                `<li id="item-${index}" aria-label="Item ${index}"><div>t</div><div>ask</div></li>`
            ).join("")}
          </ul>
          <span>note</span>
        </div>
      </main>
    `;
    const archived: number[] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "ItemsPage.items.archive",
          goal_met: 0.1,
          arguments: { ref: "ItemsPage.items[1]" },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    class ItemsPage {
      readonly items = Array.from({ length: count }, (_, index) => ({
        root: page.locator(`#item-${index}`),
        // An action that changes nothing on the page.
        archive: () => archived.push(index),
      }));
    }
    registerCompiledPom(
      ItemsPage,
      manifest(
        "ItemsPage",
        [collection("items", "Item")],
        [],
        [
          {
            className: "Item",
            members: [root()],
            tools: [action("archive", "archive")],
          },
        ]
      )
    );
    const tool = await getPublishedPursueGoal(decide);
    createPageRegistration(ItemsPage);

    const result = (await tool.execute({
      goal: "archive the second item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // The page the model read: no wrapper, the leaves' text hoisted as it was.
    const sent = JSON.stringify(requests[0]!.state);
    expect(sent).not.toContain('"role":"generic"');
    expect(sent).toContain('"name":"Item 1","children":["t","ask"]');

    // The instance options come from the full capture and still resolve.
    const instanceRefs = Object.keys(criteriaOf(requests[1]!).ref!);
    expect(instanceRefs).toHaveLength(count);
    const resolutions = await resolvePageStateRefs(
      document,
      ...instanceRefs.map((ref) => AriaRefSchema.parse(ref))
    );
    expect(resolutions.map((resolution) => resolution.status)).toEqual(
      instanceRefs.map(() => "resolved")
    );
    expect(archived).toEqual([1]);

    // The Change Record of the action diffs full against full: an action
    // that changed nothing reports no change, and no phantom wrapper.
    expect(result.history).toEqual([
      expect.objectContaining({
        operation: "ItemsPage.items.archive",
        chosen: {
          ref: {
            key: instanceRefs[1],
            description: criteriaOf(requests[1]!).ref![instanceRefs[1]!],
          },
        },
        result: "ok",
        page_changed: false,
      }),
    ]);
    // The agent's next Change Record: from the page the Handover gave it.
    const handedOver = agentCursor().current()!;
    const { tree: now } = await getPageStateCaptureForDocument(document);
    const record = StructuralTree.reconcile(
      await handedOver.tree.resolve(),
      now
    );
    expect(record.hasAnyChanges()).toBe(false);
    expect(renderChangeRecord(record)).toBe("");
  });

  it("hands over, naming the collection instance, when the instances exceed the option limit", async () => {
    const { requests, decide } = recording(
      scriptedDecisionFn([
        { operation: "ItemsPage.items.archive", goal_met: 0.1 },
      ])
    );
    const tool = await registerItemsPom(
      decide,
      256,
      [action("archive", "archive")],
      () => ({ archive: () => undefined })
    );

    const result = (await tool.execute({
      goal: "archive an item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    // The cap still ends the run for instances; the wording names what the
    // operation acts on.
    expect(result).toMatchObject({
      reason: "needs_value",
      next: expect.stringContaining("acts on a collection instance"),
      needs: { tool: "ItemsPage.items.archive", parameters: ["ref"] },
    });
    expect(result.next).not.toContain("one element");
    expect(requests).toHaveLength(1);
    // 256 is one instance over the option limit. The run reads the page three
    // times, and each read checks every root against its siblings, so the
    // time grows with the square of the instance count: about 0.7 s locally,
    // 13 to 17 s on CI (three reads of about 5.6 s each).
  }, 30_000);

  it("asks one instance question for a nested collection", async () => {
    document.body.innerHTML = `
      <main>
        <div id="group-0"><ul><li id="item-0-0">A</li><li id="item-0-1">B</li></ul></div>
        <div id="group-1"><ul><li id="item-1-0">C</li></ul></div>
      </main>
    `;
    const acted: string[] = [];
    class GroupsPage {
      readonly groups = [0, 1].map((group) => ({
        root: page.locator(`#group-${group}`),
        items: (group === 0 ? [0, 1] : [0]).map((item) => ({
          root: page.locator(`#item-${group}-${item}`),
          open: () => acted.push(`${group}-${item}`),
        })),
      }));
    }
    registerCompiledPom(
      GroupsPage,
      manifest(
        "GroupsPage",
        [collection("groups", "Group")],
        [],
        [
          {
            className: "Group",
            members: [root(), collection("items", "Item")],
            tools: [],
          },
          {
            className: "Item",
            members: [root()],
            tools: [action("open", "open")],
          },
        ]
      )
    );
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "GroupsPage.groups.items.open",
          goal_met: 0.1,
          arguments: { ref: "GroupsPage.groups[0].items[1]" },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);
    createPageRegistration(GroupsPage);

    await tool.execute({ goal: "open the second item", maxSteps: 5 });

    const stageTwo = criteriaOf(requests[1]!);
    // One question, over the innermost roots only.
    expect(Object.keys(stageTwo)).toEqual(["ref"]);
    expect(Object.values(stageTwo.ref!)).toEqual([
      expect.stringContaining("GroupsPage.groups[0].items[0]"),
      expect.stringContaining("GroupsPage.groups[0].items[1]"),
      expect.stringContaining("GroupsPage.groups[1].items[0]"),
    ]);
    expect(acted).toEqual(["0-1"]);
  });

  it("offers the instance root for a tool on a singular child of a collection", async () => {
    document.body.innerHTML = `
      <main>
        <div id="item-0" aria-label="Item 0"><button id="child-0">Open 0</button></div>
        <div id="item-1" aria-label="Item 1"><button id="child-1">Open 1</button></div>
      </main>
    `;
    const opened: number[] = [];
    class ItemsPage {
      readonly items = [0, 1].map((index) => ({
        root: page.locator(`#item-${index}`),
        child: {
          root: page.locator(`#child-${index}`),
          open: () => opened.push(index),
        },
      }));
    }
    registerCompiledPom(
      ItemsPage,
      manifest(
        "ItemsPage",
        [collection("items", "Item")],
        [],
        [
          {
            className: "Item",
            members: [
              root(),
              {
                memberName: "child",
                kind: "component",
                access: "field",
                componentClassName: "Child",
                collection: false,
              },
            ],
            tools: [],
          },
          { className: "Child", members: [root()], tools: [action("open")] },
        ]
      )
    );
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "ItemsPage.items.child.open",
          goal_met: 0.1,
          arguments: { ref: "ItemsPage.items[1]" },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await getPublishedPursueGoal(decide);
    createPageRegistration(ItemsPage);

    await tool.execute({ goal: "open the second item", maxSteps: 5 });

    // The instance is addressed through the last collection, not through the
    // singular child the action lives on.
    const descriptions = Object.values(criteriaOf(requests[1]!).ref!);
    expect(descriptions).toEqual([
      expect.stringContaining("ItemsPage.items[0]"),
      expect.stringContaining("ItemsPage.items[1]"),
    ]);
    for (const description of descriptions)
      expect(description).not.toContain("child");
    expect(opened).toEqual([1]);
  });

  it("does not offer a collection tool while the collection is empty", async () => {
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "none", goal_met: 0.1 }])
    );
    const tool = await registerItemsPom(
      decide,
      0,
      [action("archive", "archive")],
      () => ({ archive: () => undefined })
    );

    const result = (await tool.execute({
      goal: "archive the second item",
      maxSteps: 5,
    })) as Record<string, unknown>;

    expect(Object.keys(criteriaOf(requests[0]!).operation!)).not.toContain(
      "ItemsPage.items.archive"
    );
    // No question without options is ever sent.
    expect(requests).toHaveLength(1);
    expect(result.reason).toBe("no_fitting_option");
  });

  it("asks a collection tool's enum and boolean arguments with the instance", async () => {
    const calls: unknown[][] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "ItemsPage.items.configure",
          goal_met: 0.1,
          arguments: {
            ref: "ItemsPage.items[1]",
            "args.mode": "full",
            "args.confirm": "true",
          },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await registerItemsPom(
      decide,
      2,
      [
        actionWithParameters("configure", "configure", [
          {
            name: "mode",
            optional: false,
            schema: { type: "string", enum: ["compact", "full"] },
          },
          { name: "confirm", optional: false, schema: { type: "boolean" } },
        ]),
      ],
      (index) => ({
        configure: (mode: string, confirm: boolean) =>
          calls.push([index, mode, confirm]),
      })
    );

    await tool.execute({ goal: "configure the second item", maxSteps: 5 });

    // One request carries every question the chosen operation still needs.
    expect(requests).toHaveLength(3);
    expect(Object.keys(criteriaOf(requests[1]!))).toEqual([
      "ref",
      "args.mode",
      "args.confirm",
    ]);
    expect(calls).toEqual([[1, "full", true]]);
  });

  it("hands over when a collection tool needs a free value", async () => {
    const { requests, decide } = recording(
      scriptedDecisionFn([
        { operation: "ItemsPage.items.rename", goal_met: 0.1 },
      ])
    );
    const tool = await registerItemsPom(
      decide,
      2,
      [actionWithParam("rename", "rename")],
      () => ({ rename: () => undefined })
    );

    const result = await tool.execute({
      goal: "rename the second item",
      maxSteps: 5,
    });

    expect(withoutChanges(result)).toEqual({
      reason: "needs_value",
      next: expect.stringContaining("ItemsPage.items.rename"),
      history: [],
      needs: {
        tool: "ItemsPage.items.rename",
        parameters: ["ref", "args.value"],
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("ends the run when the model answers outside the offered instances", async () => {
    const archived: number[] = [];
    const decide = scriptedDecisionFn([
      {
        operation: "ItemsPage.items.archive",
        goal_met: 0.1,
        arguments: { ref: { raw: "e999" } },
      },
    ]);
    const tool = await registerItemsPom(
      decide,
      3,
      [action("archive", "archive")],
      (index) => ({ archive: () => archived.push(index) })
    );

    const result = await tool.execute({
      goal: "archive the second item",
      maxSteps: 5,
    });

    expect(withoutChanges(result)).toEqual({
      reason: "decide_failed",
      next: expect.stringContaining("not one of the offered options"),
      history: [],
    });
    expect(archived).toEqual([]);
  });

  it("hands over instead of asking when the page offers more operations than the limit", async () => {
    setupDom();
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "none", goal_met: 0.1 }])
    );
    // Together with the single-element Browser Tools and "none", over the option limit.
    const tool = await getPublishedPursueGoal(
      decide,
      Array.from({ length: 254 }, (_, index) => ({
        name: `operation_${index}`,
        description: `Operation number ${index}.`,
        execute: async () => null,
      }))
    );

    const result = await tool.execute({ goal: "do something", maxSteps: 5 });

    expect(result).toMatchObject({ reason: "decide_failed", history: [] });
    // The oversized question is never sent.
    expect(requests).toEqual([]);
  });

  // --- Option keys stay distinct within one question ---

  /** Register a POM whose single tool takes one closed-set parameter. */
  async function registerPomWithParameter(
    goalLoop: GoalLoopDecisionFunction,
    parameter: ToolManifest["parameters"][number],
    calls: unknown[][]
  ) {
    setupDom();
    class App {
      root = page.locator("main");
      pick(value?: unknown) {
        calls.push([value]);
      }
    }
    registerCompiledPom(
      App,
      manifest(
        "App",
        [root()],
        [actionWithParameters("pick", "App.pick", [parameter])]
      )
    );
    const tool = await getPublishedPursueGoal(goalLoop);
    createPageRegistration(App);
    return tool;
  }

  it("keeps an enum value that reads like the leave-unset choice apart from it", async () => {
    const calls: unknown[][] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "App.pick",
          goal_met: 0.1,
          arguments: { value: { nth: 0 } },
        },
        {
          operation: "App.pick",
          goal_met: 0.1,
          arguments: { value: { nth: 2 } },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await registerPomWithParameter(
      decide,
      {
        name: "value",
        optional: true,
        schema: { type: "string", enum: ["leave_unset", "asc"] },
      },
      calls
    );

    await tool.execute({ goal: "pick a value", maxSteps: 5 });

    // Both enum values and the leave-unset choice are offered.
    expect(Object.keys(criteriaOf(requests[1]!).value!)).toHaveLength(3);
    // The first option passes its value; the extra choice omits the parameter.
    expect(calls).toEqual([["leave_unset"], [undefined]]);
  });

  it("keeps enum values that differ only by type apart", async () => {
    const calls: unknown[][] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        {
          operation: "App.pick",
          goal_met: 0.1,
          arguments: { value: { nth: 0 } },
        },
        {
          operation: "App.pick",
          goal_met: 0.1,
          arguments: { value: { nth: 1 } },
        },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    const tool = await registerPomWithParameter(
      decide,
      { name: "value", optional: false, schema: { enum: [1, "1"] } },
      calls
    );

    await tool.execute({ goal: "pick a value", maxSteps: 5 });

    expect(Object.keys(criteriaOf(requests[1]!).value!)).toHaveLength(2);
    expect(calls).toEqual([[1], ["1"]]);
  });

  it("hands over instead of asking when an enum holds more values than the limit", async () => {
    const calls: unknown[][] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "App.pick", goal_met: 0.1 }])
    );
    const tool = await registerPomWithParameter(
      decide,
      {
        name: "value",
        optional: false,
        schema: {
          type: "string",
          enum: Array.from({ length: 256 }, (_, index) => `value-${index}`),
        },
      },
      calls
    );

    const result = await tool.execute({ goal: "pick a value", maxSteps: 5 });

    expect(result).toMatchObject({
      reason: "needs_value",
      needs: { tool: "App.pick", parameters: ["value"] },
    });
    // The oversized question is never sent.
    expect(requests).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("leaves an optional parameter unset when its options exceed the limit", async () => {
    const calls: unknown[][] = [];
    const { requests, decide } = recording(
      scriptedDecisionFn([
        { operation: "App.pick", goal_met: 0.1 },
        { operation: "none", goal_met: 0.9 },
      ])
    );
    // 255 values plus the leave-unset choice would be one option too many.
    const tool = await registerPomWithParameter(
      decide,
      {
        name: "value",
        optional: true,
        schema: {
          type: "string",
          enum: Array.from({ length: 255 }, (_, index) => `value-${index}`),
        },
      },
      calls
    );

    await tool.execute({ goal: "pick a value", maxSteps: 5 });

    // Two steps, each one stage-one request; no stage two was asked.
    expect(requests).toHaveLength(2);
    expect(calls).toEqual([[undefined]]);
  });
});
