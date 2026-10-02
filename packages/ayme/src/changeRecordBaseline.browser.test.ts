import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import type { PomManifest, ToolManifest } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import { configureGoalLoop, type GoalLoopDecisionFunction } from "./goalLoop";
import { getPageStateForElements } from "./pageState";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createRuntimeSession } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

type ActionResultShape = {
  page_changed: boolean;
  settled: boolean;
  changes?: string;
};

const TOAST = '<div role="status">Background toast</div>';

describe("Change Record baseline in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let published: Map<string, PublishedTool>;
  let stop: (() => void) | undefined;
  let disposePublication: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
    published = new Map();
  });

  afterEach(() => {
    disposePublication?.();
    disposePublication = undefined;
    stop?.();
    stop = undefined;
    configureGoalLoop(undefined);
    document.body.innerHTML = "";
  });

  function startRuntime(goalLoop?: GoalLoopDecisionFunction) {
    const runtime = createRuntimeSession({ page: () => page, goalLoop });
    stop = runtime.start();
  }

  async function publishTools() {
    const publication = await synchronizeWebMcpTools({
      async registerTool(registered: PublishedTool) {
        published.set(registered.name, registered);
      },
    });
    disposePublication = publication.dispose;
  }

  /** Register a Page Object whose only action leaves the page untouched. */
  async function startWithNoopPom(goalLoop?: GoalLoopDecisionFunction) {
    document.body.innerHTML = '<main><button id="act">Act</button></main>';
    const currentPage = page;
    class App {
      root = currentPage.locator("main");
      noop() {}
    }
    registerCompiledPom(App, manifest("App", [action("noop", "App.noop")]));
    startRuntime(goalLoop);
    createPageRegistration(App);
    await publishTools();
  }

  function tool(name: string): PublishedTool {
    const found = published.get(name);
    if (!found) throw new Error(`Tool ${name} was not published.`);
    return found;
  }

  async function readStructure(): Promise<string> {
    const context = (await tool("get_page_context").execute({})) as {
      structure: string;
    };
    return context.structure;
  }

  async function act(
    name: string,
    input: Record<string, unknown>
  ): Promise<ActionResultShape> {
    return (await tool(name).execute(input)) as ActionResultShape;
  }

  // --- A change between the caller's read and its next action ---

  it("reports a change made after get_page_context in the click's Change Record", async () => {
    document.body.innerHTML = '<button id="act">Act</button>';
    startRuntime();
    await publishTools();

    const actRef = refFor(await readStructure(), "Act");
    document.body.insertAdjacentHTML("beforeend", TOAST);

    const result = await act("click_page_state_ref", { ref: actRef });

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Background toast");
  });

  it("reports a change made after get_page_context in the fill's Change Record", async () => {
    document.body.innerHTML = '<input id="name" aria-label="Name">';
    startRuntime();
    await publishTools();

    const nameRef = refFor(await readStructure(), "Name", "textbox");
    document.body.insertAdjacentHTML("beforeend", TOAST);

    const result = await act("fill_page_state_ref", {
      ref: nameRef,
      value: "Ada",
    });

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Background toast");
  });

  it("reports a change made after get_page_context in a Generated WebMCP Tool's Change Record", async () => {
    await startWithNoopPom();

    await readStructure();
    document.body.insertAdjacentHTML("beforeend", TOAST);

    const result = await act("App.noop", {});

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Background toast");
  });

  // --- Two actions in a row ---

  it("starts the second Change Record from the first action's Settled Page", async () => {
    document.body.innerHTML = `
      <button id="first">First</button>
      <button id="second">Second</button>
    `;
    document.querySelector("#first")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        "<p>Result of the first action</p>"
      );
    });
    startRuntime();
    await publishTools();

    const structure = await readStructure();
    const firstRef = refFor(structure, "First");
    const secondRef = refFor(structure, "Second");

    const first = await act("click_page_state_ref", { ref: firstRef });
    expect(first.changes).toContain("Result of the first action");

    document.body.insertAdjacentHTML("beforeend", TOAST);

    const second = await act("click_page_state_ref", { ref: secondRef });
    expect(second.page_changed).toBe(true);
    expect(second.changes).toContain("Background toast");
    expect(second.changes).not.toContain("Result of the first action");
  });

  // --- A capture Ayme makes for itself must not consume the change ---

  it("keeps the Change Record complete when the inspector captures in between", async () => {
    document.body.innerHTML = '<button id="act">Act</button>';
    startRuntime();
    await publishTools();

    const actRef = refFor(await readStructure(), "Act");
    document.body.insertAdjacentHTML("beforeend", TOAST);
    await getPageStateForElements([document.querySelector("#act")!]);

    const result = await act("click_page_state_ref", { ref: actRef });

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Background toast");
  });

  // --- No change at all ---

  it("reports page_changed false when neither the action nor the page changed anything", async () => {
    document.body.innerHTML = '<button id="act">Act</button>';
    // Focus first: the click would otherwise move focus, a change of its own.
    await page.locator("#act").focus();
    startRuntime();
    await publishTools();

    const result = await act("click_page_state_ref", {
      ref: refFor(await readStructure(), "Act"),
    });

    expect(result.page_changed).toBe(false);
    expect(result.changes).toBeUndefined();
  });

  // --- Goal Loop ---

  it("counts a change made while the decision function is pending into that step's page_changed", async () => {
    let step = 0;
    const decide: GoalLoopDecisionFunction = async (
      request: DecisionRequest
    ): Promise<DecisionResponse> => {
      const first = step++ === 0;
      if (first) document.body.insertAdjacentHTML("beforeend", TOAST);
      return {
        model: request.model,
        answers: {
          operation: {
            type: "choice",
            choice: first ? "App.noop" : "none",
            confidence: 1,
          },
          goal_met: { type: "noul", noul: first ? 0.1 : 0.9 },
        },
      };
    };

    await startWithNoopPom(decide);

    const handover = (await tool("pursue_goal").execute({
      goal: "do the thing",
      maxSteps: 3,
    })) as { history: { page_changed: boolean }[] };

    expect(handover.history).toHaveLength(1);
    expect(handover.history[0]!.page_changed).toBe(true);
  });
});

const action = (methodName: string, toolName: string): ToolManifest => ({
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

const manifest = (className: string, tools: ToolManifest[]): PomManifest => ({
  className,
  members: [{ memberName: "root", kind: "locator", access: "field" }],
  tools,
  components: [],
});

function refFor(text: string, accessibleName: string, role = "button") {
  const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = text.match(
    new RegExp(`(?:^|\\s)(e\\d+) ${role} "${escapedName}"`)
  )?.[1];
  if (!ref) throw new Error(`Expected a Structural Ref for ${accessibleName}.`);
  return AriaRefSchema.parse(ref);
}
