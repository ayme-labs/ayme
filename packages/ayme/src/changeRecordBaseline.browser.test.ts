import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import type { PomManifest, ToolManifest } from "./contracts";
import type { DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import { configureGoalLoop, type GoalLoopDecisionFunction } from "./goalLoop";
import { getPageStateForElements } from "./pageState";
import { agentTools } from "./publication.testSupport";
import {
  createPageRegistration,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import { createAyme } from "./runtime";

type ActionResultShape = {
  page_changed: boolean;
  settled: boolean;
  changes_before?: string;
  changes?: string;
};

const TOAST = '<div role="status">Background toast</div>';

describe("Change Record baseline in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    configureGoalLoop(undefined);
    document.body.innerHTML = "";
  });

  function startRuntime(goalLoop?: GoalLoopDecisionFunction) {
    const runtime = createAyme({ pageFactory: () => page, goalLoop });
    stop = runtime.start();
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
    // Its tool is published once a probe finds the Page Object available.
    await probeRegisteredPomMembers();
  }

  async function readStructure(): Promise<string> {
    const context = (await agentTools().call("snapshot", {})) as {
      structure: string;
    };
    return context.structure;
  }

  async function act(
    name: string,
    input: Record<string, unknown>
  ): Promise<ActionResultShape> {
    return (await agentTools().call(name, input)) as ActionResultShape;
  }

  // --- A change between the caller's read and its next action ---

  it("reports a change made after snapshot in the click's Change Record", async () => {
    document.body.innerHTML = '<button id="act">Act</button>';
    startRuntime();

    const actRef = refFor(await readStructure(), "Act");
    document.body.insertAdjacentHTML("beforeend", TOAST);

    const result = await act("click", { target: actRef });

    expect(result.page_changed).toBe(true);
    expect(result.changes_before).toContain("Background toast");
    expect(result.changes).not.toContain("Background toast");
  });

  it("reports a change made after snapshot in the fill's Change Record", async () => {
    document.body.innerHTML = '<input id="name" aria-label="Name">';
    startRuntime();

    const nameRef = refFor(await readStructure(), "Name", "textbox");
    document.body.insertAdjacentHTML("beforeend", TOAST);

    const result = await act("fill", {
      target: nameRef,
      text: "Ada",
    });

    expect(result.page_changed).toBe(true);
    expect(result.changes_before).toContain("Background toast");
    expect(result.changes).toContain("Ada");
  });

  it("reports a change made after snapshot in a Page Object Tool's Change Record", async () => {
    await startWithNoopPom();

    await readStructure();
    document.body.insertAdjacentHTML("beforeend", TOAST);

    const result = await act("App.noop", {});

    // The action itself changed nothing: only the first part has a change.
    expect(result.page_changed).toBe(true);
    expect(result.changes_before).toContain("Background toast");
    expect(result.changes).toBeUndefined();
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

    const structure = await readStructure();
    const firstRef = refFor(structure, "First");
    const secondRef = refFor(structure, "Second");

    const first = await act("click", { target: firstRef });
    expect(first.changes).toContain("Result of the first action");

    document.body.insertAdjacentHTML("beforeend", TOAST);

    const second = await act("click", { target: secondRef });
    expect(second.page_changed).toBe(true);
    expect(second.changes_before).toContain("Background toast");
    expect(second.changes_before).not.toContain("Result of the first action");
  });

  // --- A capture Ayme makes for itself must not consume the change ---

  it("keeps the Change Record complete when the inspector captures in between", async () => {
    document.body.innerHTML = '<button id="act">Act</button>';
    startRuntime();

    const actRef = refFor(await readStructure(), "Act");
    document.body.insertAdjacentHTML("beforeend", TOAST);
    await getPageStateForElements([document.querySelector("#act")!]);

    const result = await act("click", { target: actRef });

    expect(result.page_changed).toBe(true);
    expect(result.changes_before).toContain("Background toast");
  });

  // --- No change at all ---

  it("reports page_changed false when neither the action nor the page changed anything", async () => {
    document.body.innerHTML = '<button id="act">Act</button>';
    // Focus first: the click would otherwise move focus, a change of its own.
    await page.locator("#act").focus();
    startRuntime();

    const result = await act("click", {
      target: refFor(await readStructure(), "Act"),
    });

    expect(result.page_changed).toBe(false);
    expect(result.changes).toBeUndefined();
  });

  // --- Goal Loop ---

  it("counts a change made while the decision function is pending into that step's page_changed", async () => {
    let step = 0;
    const decide: GoalLoopDecisionFunction =
      async (): Promise<DecisionResponse> => {
        const first = step++ === 0;
        if (first) document.body.insertAdjacentHTML("beforeend", TOAST);
        return {
          model: "typesafe/jev-1.13",
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

    const handover = (await agentTools().call("goal", {
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
