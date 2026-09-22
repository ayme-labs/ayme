import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import type { PomManifest, ToolManifest } from "./contracts";
import { createPage } from "./browserPage";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createRuntimeSession } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";
import {
  configureGoalLoop,
  getLastGoalLoopRunResult,
  type GoalLoopDecisionFunction,
} from "./goalLoop";
import type { RefTool } from "./refTools";

// --- Fixtures ---

const action = (methodName: string, toolName = methodName): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  parameters: [],
});

const actionWithParam = (
  methodName: string,
  toolName = methodName
): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
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
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(
      parameters.map((parameter) => [parameter.name, parameter.schema])
    ),
    required: parameters
      .filter((parameter) => !parameter.optional)
      .map((parameter) => parameter.name),
    additionalProperties: false,
  },
  parameters,
});

const root = () =>
  ({ memberName: "root", kind: "locator", access: "field" }) as const;

const manifest = (
  className: string,
  members: PomManifest["members"],
  tools: ToolManifest[] = []
): PomManifest => ({
  className,
  members,
  tools,
  components: [],
});

// --- Scripted fake decision function ---

/**
 * Stage two: which option to choose — by key or description, by position in
 * the offered options, or `raw` to answer with something not offered.
 */
type ScriptedChoice = string | { nth: number } | { raw: string };

type ScriptedAnswer = {
  operation: string;
  goal_met: number;
  /** Per parameter of the chosen operation. */
  arguments?: Record<string, ScriptedChoice>;
};

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

function choiceAnswer(criteria: Criteria, chosenKey: string) {
  const probabilities: Record<string, number> = {};
  for (const key of Object.keys(criteria))
    probabilities[key] = key === chosenKey ? 1 : 0;
  return { type: "choice", choice: chosenKey, confidence: 1, probabilities };
}

/** The key of the option the script names. */
function keyFor(criteria: Criteria, wanted: ScriptedChoice): string {
  if (typeof wanted === "object")
    return "raw" in wanted ? wanted.raw : nthKey(criteria, wanted.nth);
  const key = Object.keys(criteria).find(
    (candidate) => candidate === wanted || criteria[candidate] === wanted
  );
  if (!key)
    throw new Error(`No option "${wanted}" among ${JSON.stringify(criteria)}`);
  return key;
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

    // Stage two: one choice question per parameter of the chosen operation.
    if (!criteria.operation) {
      const current = answers[step - 1];
      const wanted = current?.arguments ?? {};
      const stageTwo: Record<string, unknown> = {};
      for (const [parameter, options] of Object.entries(criteria)) {
        const want = wanted[parameter];
        if (want === undefined)
          throw new Error(`No scripted argument for "${parameter}"`);
        stageTwo[parameter] = choiceAnswer(options, keyFor(options, want));
      }
      return { model: request.model, answers: stageTwo };
    }

    const current = answers[step];
    if (!current) throw new Error(`No scripted answer for step ${step}`);
    step++;

    return {
      model: request.model,
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
      requests.push(request);
      return decide(request);
    }) satisfies GoalLoopDecisionFunction,
  };
}

// --- Fake driver that captures published tools ---

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

function createFakeDriver() {
  const published = new Map<string, PublishedTool>();
  const driver = {
    async registerTool(tool: PublishedTool) {
      published.set(tool.name, tool);
    },
  };
  return { driver, published };
}

// --- Test setup ---

describe("Goal Loop pursue_goal in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let stop: (() => void) | undefined;
  let disposePublication: (() => void) | undefined;
  let clickCount: number;

  beforeEach(() => {
    document.body.innerHTML = "";
    clickCount = 0;
    page = createPage();
  });

  afterEach(() => {
    disposePublication?.();
    disposePublication = undefined;
    stop?.();
    stop = undefined;
    configureGoalLoop(undefined);
    document.body.innerHTML = "";
  });

  function startRuntime(
    goalLoop: GoalLoopDecisionFunction,
    refTools?: RefTool[]
  ) {
    const runtime = createRuntimeSession(page, { goalLoop, refTools });
    stop = runtime.start();
    return runtime;
  }

  async function getPublishedPursueGoal(
    goalLoop: GoalLoopDecisionFunction,
    refTools?: RefTool[]
  ): Promise<PublishedTool> {
    startRuntime(goalLoop, refTools);
    const { driver, published } = createFakeDriver();
    const publication = await synchronizeWebMcpTools(driver);
    disposePublication = publication.dispose;
    const tool = published.get("pursue_goal");
    if (!tool) throw new Error("pursue_goal not published");
    return tool;
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
    expect(result).toEqual({
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
          did: "save",
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
    expect(result).toEqual({
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
    expect(result).toEqual({
      reason: "needs_value",
      next: expect.stringContaining("App.fill"),
      history: [],
      needs: { tool: "App.fill", parameters: ["value"] },
    });
  });

  it("offers a registered Ref Tool as an operation", async () => {
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
      scriptedDecisionFn([{ operation: "fill_page_state_ref", goal_met: 0.1 }])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({
      goal: "put a name into the field",
      maxSteps: 5,
    });

    expect(result).toEqual({
      reason: "needs_value",
      next: expect.stringContaining("fill_page_state_ref"),
      history: [],
      needs: { tool: "fill_page_state_ref", parameters: ["ref", "value"] },
    });
    // No second request: the loop never asks for a tool it cannot fill.
    expect(requests).toHaveLength(1);
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
        { did: "fail", result: "action exploded", page_changed: false },
        { did: "fail", result: "action exploded", page_changed: false },
      ],
    });
    expect((result as Record<string, unknown>).next).toContain(
      "Two operations failed"
    );
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
        { did: "save", result: "ok", page_changed: false },
        { did: "save", result: "ok", page_changed: false },
      ],
    });
    expect(clickCount).toBe(2);
  });

  // --- Handover reason: decide_failed ---

  it("returns decide_failed when the decision function throws", async () => {
    const decide = failingDecisionFn(new Error("network error"));
    const tool = await registerPom(decide);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(result).toEqual({
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
    expect(result).toEqual({
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

  it("records readable labels, ok results, and page_changed in history", async () => {
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
    expect(history[0]).toMatchObject({
      did: "save",
      result: "ok",
    });
    expect(history[0]!.page_changed).toBe(true);
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
        model: request.model,
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
          operation: "click_page_state_ref",
          goal_met: 0.1,
          arguments: { ref: 'button "Save changes"' },
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
      criteriaOf(requests[1]!).ref!
    );
    expect(rest).toEqual([]);
    // Options carry the node's ref as their key, as the page state labels it,
    // and its role and name so the model can tell options apart.
    expect(refsInPage(requests[1]!.state)).toContain(key);
    expect(description).toContain("button");
    expect(description).toContain("Save changes");
    expect(clickCount).toBe(1);
    expect(result.reason).toBe("done");
    expect(result.history).toMatchObject([
      { did: expect.stringContaining("Save changes"), result: "ok" },
    ]);
  });

  it("offers a Ref Tool with a filter only the elements it keeps", async () => {
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

  it("offers a Ref Tool without a filter every node that has a ref", async () => {
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

  it("hands over instead of asking when a ref question would exceed the option limit", async () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 256 },
      (_, index) => `<button>Item ${index}</button>`
    ).join("")}</main>`;
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "click_page_state_ref", goal_met: 0.1 }])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({ goal: "click an item", maxSteps: 5 });

    expect(result).toEqual({
      reason: "needs_value",
      next: expect.stringContaining("click_page_state_ref"),
      history: [],
      needs: { tool: "click_page_state_ref", parameters: ["ref"] },
    });
    // The oversized question is never sent.
    expect(requests).toHaveLength(1);
  });

  it("hands over when no element on the page fits the chosen operation", async () => {
    document.body.innerHTML = `<main><p>Nothing to do here.</p></main>`;
    const { requests, decide } = recording(
      scriptedDecisionFn([{ operation: "click_page_state_ref", goal_met: 0.1 }])
    );
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({ goal: "click something", maxSteps: 5 });

    expect(result).toMatchObject({
      reason: "needs_value",
      needs: { tool: "click_page_state_ref", parameters: ["ref"] },
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

    await tool.execute({ goal: "configure the app", maxSteps: 5 });

    const stageTwo = criteriaOf(requests[1]!);
    expect(Object.keys(stageTwo)).toEqual(["mode", "confirm"]);
    expect(Object.keys(stageTwo.mode!)).toEqual(["compact", "full"]);
    expect(Object.keys(stageTwo.confirm!)).toEqual(["true", "false"]);
    expect(calls).toEqual([["full", true]]);
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

    await tool.execute({ goal: "sort the list", maxSteps: 5 });

    // The enum's own values, plus one more choice that leaves it unset.
    expect(Object.keys(criteriaOf(requests[1]!).order!)).toEqual([
      "asc",
      "desc",
      "leave_unset",
    ]);
    expect(calls).toEqual([[undefined]]);
  });

  it("records the scores of stage two per step in the internal run result", async () => {
    setupPageWithOneClickable();
    const decide = scriptedDecisionFn([
      {
        operation: "click_page_state_ref",
        goal_met: 0.1,
        arguments: { ref: 'button "Save changes"' },
      },
      { operation: "none", goal_met: 0.9 },
    ]);
    const tool = await getPublishedPursueGoal(decide);

    await tool.execute({ goal: "save the changes", maxSteps: 5 });

    const runResult = getLastGoalLoopRunResult();
    const probabilities = runResult!.stepScores[0]!.argumentProbabilities;
    expect(probabilities).toBeDefined();
    expect(Object.values(probabilities!.ref!)).toContain(1);
    expect(runResult!.stepScores[1]!.argumentProbabilities).toBeUndefined();
  });

  it("ends the run when the model answers outside the offered options", async () => {
    setupPageWithOneClickable();
    const decide = scriptedDecisionFn([
      {
        operation: "click_page_state_ref",
        goal_met: 0.1,
        arguments: { ref: { raw: "e999" } },
      },
    ]);
    const tool = await getPublishedPursueGoal(decide);

    const result = await tool.execute({
      goal: "save the changes",
      maxSteps: 5,
    });

    expect(result).toEqual({
      reason: "decide_failed",
      // The answer the loop could not use is named in plain words.
      next: expect.stringContaining("e999"),
      history: [],
    });
    expect(clickCount).toBe(0);
  });

  // --- Option keys stay distinct within one question (#114) ---

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
