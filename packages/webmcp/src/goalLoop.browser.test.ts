import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import type { PomManifest, ToolManifest } from "./contracts";
import { createPage } from "./browserPage";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createRuntimeSession } from "./runtime";
import {
  configureGoalLoop,
  createPursueGoalTool,
  type GoalLoopDecisionFunction,
} from "./goalLoop";

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

type ScriptedAnswer = {
  operation: string;
  goal_met: number;
};

function scriptedDecisionFn(
  answers: ScriptedAnswer[]
): GoalLoopDecisionFunction {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const current = answers[step];
    if (!current) throw new Error(`No scripted answer for step ${step}`);
    step++;

    // Build a valid response
    const operationCriteria =
      (
        request.questions as Record<
          string,
          { criteria?: Record<string, string> }
        >
      ).operation?.criteria ?? {};
    const operationKeys = Object.keys(operationCriteria);
    const probabilities: Record<string, number> = {};
    for (const key of operationKeys) {
      probabilities[key] = key === current.operation ? 1 : 0;
    }

    return {
      model: request.model,
      answers: {
        operation: {
          type: "choice",
          choice: current.operation,
          confidence: 1,
          probabilities,
        },
        goal_met: {
          type: "noul",
          noul: current.goal_met,
        },
      },
    };
  };
}

function failingDecisionFn(error: Error): GoalLoopDecisionFunction {
  return async () => {
    throw error;
  };
}

// --- Test setup ---

describe("Goal Loop pursue_goal in Chromium", () => {
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

  function startRuntime(goalLoop: GoalLoopDecisionFunction) {
    const runtime = createRuntimeSession(page, { goalLoop });
    stop = runtime.start();
    return runtime;
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

  function registerPom(goalLoop: GoalLoopDecisionFunction) {
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
    const runtime = startRuntime(goalLoop);
    createPageRegistration(App);
    return runtime;
  }

  function registerPomWithParam(goalLoop: GoalLoopDecisionFunction) {
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
    const runtime = startRuntime(goalLoop);
    createPageRegistration(App);
    return runtime;
  }

  function registerFailingPom(goalLoop: GoalLoopDecisionFunction) {
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
    const runtime = startRuntime(goalLoop);
    createPageRegistration(App);
    return runtime;
  }

  // --- Handover reason: done ---

  it("returns done when goal_met >= 0.5 on the first step", async () => {
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.8 }]);
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
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
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(result).toMatchObject({
      reason: "done",
      history: [
        {
          did: "App.save",
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
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
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
    registerPomWithParam(decide);
    const tool = createPursueGoalTool(decide, document);
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

  // --- Handover reason: action_failed ---

  it("returns action_failed after two consecutive failures", async () => {
    const decide = scriptedDecisionFn([
      { operation: "App.fail", goal_met: 0.1 },
      { operation: "App.fail", goal_met: 0.1 },
    ]);
    registerFailingPom(decide);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({ goal: "do the thing", maxSteps: 5 });
    expect(result).toMatchObject({
      reason: "action_failed",
      history: [
        { did: "App.fail", result: "action exploded", page_changed: false },
        { did: "App.fail", result: "action exploded", page_changed: false },
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
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({ goal: "save many times", maxSteps: 2 });
    expect(result).toMatchObject({
      reason: "step_budget",
      history: [
        { did: "App.save", result: "ok", page_changed: false },
        { did: "App.save", result: "ok", page_changed: false },
      ],
    });
    expect(clickCount).toBe(2);
  });

  // --- Handover reason: decide_failed ---

  it("returns decide_failed when the decision function throws", async () => {
    const decide = failingDecisionFn(new Error("network error"));
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({ goal: "save changes", maxSteps: 5 });
    expect(result).toEqual({
      reason: "decide_failed",
      next: expect.stringContaining("network error"),
      history: [],
    });
  });

  // --- Order of checks ---

  it("checks done before no_fitting_option (goal_met >= 0.5 wins over none)", async () => {
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.5 }]);
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({ goal: "already done", maxSteps: 5 });
    expect((result as Record<string, unknown>).reason).toBe("done");
  });

  it("checks no_fitting_option before needs_value", async () => {
    // If model chose none AND a tool with params exists, no_fitting_option wins
    const decide = scriptedDecisionFn([{ operation: "none", goal_met: 0.1 }]);
    registerPomWithParam(decide);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({ goal: "something", maxSteps: 5 });
    expect((result as Record<string, unknown>).reason).toBe(
      "no_fitting_option"
    );
  });

  it("checks needs_value before action_failed", async () => {
    // After one failure, if the model picks a tool needing args, needs_value wins over continuing
    const decide = scriptedDecisionFn([
      { operation: "App.fail", goal_met: 0.1 },
      { operation: "App.fill", goal_met: 0.1 },
    ]);
    // Register both a failing tool and a param tool
    setupDom();
    class App {
      root = page.locator("main");
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
        [action("fail", "App.fail"), actionWithParam("fill", "App.fill")]
      )
    );
    startRuntime(decide);
    createPageRegistration(App);
    const tool = createPursueGoalTool(decide, document);
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
    // Register both tools
    setupDom();
    class App {
      root = page.locator("main");
      fail() {
        throw new Error("action exploded");
      }
      save() {
        (document.querySelector("#save") as HTMLButtonElement).click();
      }
    }
    registerCompiledPom(
      App,
      manifest(
        "App",
        [root()],
        [action("fail", "App.fail"), action("save", "App.save")]
      )
    );
    startRuntime(decide);
    createPageRegistration(App);
    const tool = createPursueGoalTool(decide, document);
    const result = await tool.execute({
      goal: "try hard",
      maxSteps: 3,
    });
    // After fail, save (resets counter), fail → should be step_budget not action_failed
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
    startRuntime(decide);
    createPageRegistration(App);
    const tool = createPursueGoalTool(decide, document);
    const result = (await tool.execute({
      goal: "save",
      maxSteps: 5,
    })) as Record<string, unknown>;
    expect(result.reason).toBe("done");
    const history = result.history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      did: "App.save",
      result: "ok",
    });
    // page_changed should be true since the result div was unhidden
    expect(history[0]!.page_changed).toBe(true);
  });

  // --- Zero-argument Page Object Action being run ---

  it("runs a zero-argument Page Object Action through the same action sequence", async () => {
    let actionCalled = false;
    document.body.innerHTML = `
      <main>
        <button id="action">Do it</button>
      </main>
    `;
    class App {
      root = page.locator("main");
      doIt() {
        actionCalled = true;
      }
    }
    registerCompiledPom(
      App,
      manifest("App", [root()], [action("doIt", "App.doIt")])
    );
    const decide = scriptedDecisionFn([
      { operation: "App.doIt", goal_met: 0.1 },
      { operation: "none", goal_met: 0.9 },
    ]);
    startRuntime(decide);
    createPageRegistration(App);
    const tool = createPursueGoalTool(decide, document);
    const result = (await tool.execute({
      goal: "do it",
      maxSteps: 5,
    })) as Record<string, unknown>;
    expect(actionCalled).toBe(true);
    expect(result.reason).toBe("done");
    expect((result.history as unknown[]).length).toBe(1);
  });

  // --- State fields sent to the model ---

  it("sends goal, page, page_objects, and history as state fields", async () => {
    let capturedRequest: DecisionRequest | undefined;
    const decide: GoalLoopDecisionFunction = async (request) => {
      capturedRequest = request;
      // Return done immediately
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
    registerPom(decide);
    const tool = createPursueGoalTool(decide, document);
    await tool.execute({ goal: "test state fields", maxSteps: 5 });

    expect(capturedRequest).toBeDefined();
    const state = capturedRequest!.state as Record<string, unknown>;
    expect(state.goal).toBe("test state fields");
    expect(typeof state.page).toBe("string");
    expect(typeof state.page_objects).toBe("string");
    expect(state.history).toEqual([]);

    // Verify questions
    const questions = capturedRequest!.questions as Record<string, unknown>;
    expect(questions.operation).toMatchObject({ type: "choice" });
    expect(questions.goal_met).toMatchObject({ type: "noul" });
  });
});
