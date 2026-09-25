import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  type StructuralActionId,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";

import type { PomManifest, ToolManifest } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import { configureGoalLoop, type GoalLoopDecisionFunction } from "./goalLoop";
import { getInteractionHistory, getPageStateForElements } from "./pageState";
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

const LOADED_URL = location.href;

describe("Interaction history in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let published: Map<string, PublishedTool>;
  let stop: (() => void) | undefined;
  let disposePublication: (() => void) | undefined;

  const history = () => getInteractionHistory(document);

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

  afterAll(() => {
    window.history.replaceState(null, "", LOADED_URL);
  });

  function startRuntime(goalLoop?: GoalLoopDecisionFunction) {
    stop = createRuntimeSession({ page: () => page, goalLoop }).start();
  }

  async function publishTools() {
    const publication = await synchronizeWebMcpTools({
      async registerTool(registered: PublishedTool) {
        published.set(registered.name, registered);
      },
    });
    disposePublication = publication.dispose;
  }

  /** A Page Object whose one action appends a paragraph. */
  async function startWithAddingPom(goalLoop?: GoalLoopDecisionFunction) {
    document.body.innerHTML = "<main><h1>List</h1></main>";
    const currentPage = page;
    class App {
      root = currentPage.locator("main");
      add() {
        document
          .querySelector("main")!
          .insertAdjacentHTML("beforeend", "<p>Added by the action</p>");
      }
    }
    registerCompiledPom(App, manifest("App", [action("add", "App.add")]));
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

  function lastActionId(): StructuralActionId {
    const ids = [...history().actions().keys()];
    if (ids.length === 0) throw new Error("No action was recorded.");
    return ids.at(-1)!;
  }

  async function expectBeforeChangeAfter(actionId: StructuralActionId) {
    const { actionChange } =
      await history().observations.getActionEvidence(actionId);
    expect(actionChange.beforeStructuralTree).toBeDefined();
    expect(actionChange.changeTree.hasAnyChanges()).toBe(true);
    expect(names(actionChange.structuralTree)).toContain("Added by the action");
    expect(names(actionChange.beforeStructuralTree!)).not.toContain(
      "Added by the action"
    );
  }

  // --- Visits ---

  it("records a Visit at document load and one per route change", async () => {
    startRuntime();
    const visits = () => history().observations.getVisits();

    expect(visits()).toHaveLength(1);
    expect(visits()[0]!.urls).toEqual([LOADED_URL]);
    await publishTools();
    await readStructure();
    const firstVisit = await history().observations.getVisitEvidence(
      visits()[0]!.id
    );
    expect(firstVisit.cause).toBe("initial");

    window.history.pushState(null, "", "?route=orders");
    await expect.poll(() => visits()).toHaveLength(2);
    expect(visits()[1]!.urls).toEqual([
      new URL("?route=orders", LOADED_URL).href,
    ]);

    // A hash change stays in the Visit; going back to it is no new Visit.
    window.history.pushState(null, "", "#details");
    window.history.back();
    await new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true })
    );
    expect(visits()).toHaveLength(2);
    expect(visits()[1]!.urls).toEqual([
      new URL("?route=orders", LOADED_URL).href,
      new URL("?route=orders#details", LOADED_URL).href,
    ]);

    window.history.replaceState(null, "", "?route=customers");
    await expect.poll(() => visits()).toHaveLength(3);
  });

  // --- Actions ---

  it("records one action with before, change and after evidence per Ref Tool call", async () => {
    document.body.innerHTML = '<main><button id="add">Add</button></main>';
    document.querySelector("#add")!.addEventListener("click", () => {
      document
        .querySelector("main")!
        .insertAdjacentHTML("beforeend", "<p>Added by the action</p>");
    });
    startRuntime();
    await publishTools();
    const addRef = refFor(await readStructure(), "Add");
    const actionsBefore = history().actions().size;

    const result = await act("click_page_state_ref", { ref: addRef });

    expect(result.changes).toContain("Added by the action");
    expect(history().actions().size).toBe(actionsBefore + 1);
    const actionId = lastActionId();
    expect(history().actions().get(actionId)).toEqual({
      caller: "agent",
      tool: "click_page_state_ref",
      args: { ref: addRef },
      targetRef: addRef,
    });
    await expectBeforeChangeAfter(actionId);
  });

  it("records one action with before, change and after evidence per Generated WebMCP Tool call", async () => {
    await startWithAddingPom();
    await readStructure();
    const actionsBefore = history().actions().size;

    const result = await act("App.add", {});

    expect(result.changes).toContain("Added by the action");
    expect(history().actions().size).toBe(actionsBefore + 1);
    const actionId = lastActionId();
    expect(history().actions().get(actionId)).toEqual({
      caller: "agent",
      tool: "App.add",
      args: {},
    });
    await expectBeforeChangeAfter(actionId);
  });

  it("keeps ref identities in the identity ledger with the action a node appeared after", async () => {
    document.body.innerHTML = '<main><button id="add">Add</button></main>';
    document.querySelector("#add")!.addEventListener("click", () => {
      const add = document.querySelector("#add")!;
      add.replaceWith(add.cloneNode(true));
      document
        .querySelector("main")!
        .insertAdjacentHTML("beforeend", "<button>Added</button>");
    });
    startRuntime();
    await publishTools();
    const addRef = refFor(await readStructure(), "Add");

    const result = await act("click_page_state_ref", { ref: addRef });
    const actionId = lastActionId();
    const ledger = await history().observations.identityLedger(
      history().pageId
    );

    expect(result.changes).toContain("Added");
    const addedRef = refFor(await readStructure(), "Added");
    expect(ledger.lifecycle(addedRef)?.appeared.afterActionId).toBe(actionId);
    // The re-rendered button got a new ref; the old one is an alias of it.
    const resolved = ledger.resolve(addRef);
    expect(resolved).toMatchObject({ status: "resolved" });
    expect(resolved.status === "resolved" && resolved.currentRef).not.toBe(
      addRef
    );
    expect(
      (await getPageStateForElements([document.querySelector("#add")!])).refs
    ).toEqual([resolved.status === "resolved" && resolved.currentRef]);
  });

  it("reports the new route's page in the Change Record of an action that navigates", async () => {
    document.body.innerHTML = '<main><a href="#" id="next">Orders</a></main>';
    document.querySelector("#next")!.addEventListener("click", (event) => {
      event.preventDefault();
      window.history.pushState(null, "", "?route=orders-page");
      document.querySelector("main")!.innerHTML = "<h1>Orders page</h1>";
    });
    startRuntime();
    await publishTools();
    const visitsBefore = history().observations.getVisits().length;

    const result = await act("click_page_state_ref", {
      ref: refFor(await readStructure(), "Orders", "link"),
    });

    expect(history().observations.getVisits()).toHaveLength(visitsBefore + 1);
    expect(result.changes).toContain("Orders page");
  });

  // --- Goal Loop ---

  it("records one action per executed Goal Loop step and keeps the agent's cursor until the Handover", async () => {
    let step = 0;
    let agentCursorDuringRun: unknown;
    const decide: GoalLoopDecisionFunction = async (
      request: DecisionRequest
    ): Promise<DecisionResponse> => {
      const first = step++ === 0;
      if (!first) agentCursorDuringRun = history().cursor("agent");
      return {
        model: request.model,
        answers: {
          operation: {
            type: "choice",
            choice: first ? "App.add" : "none",
            confidence: 1,
          },
          goal_met: { type: "noul", noul: first ? 0.1 : 0.9 },
        },
      };
    };
    await startWithAddingPom(decide);
    await readStructure();
    const agentCursor = history().cursor("agent");
    const actionsBefore = history().actions().size;

    const handover = (await tool("pursue_goal").execute({
      goal: "add one",
      maxSteps: 3,
    })) as { history: { page_changed: boolean }[] };

    expect(handover.history).toEqual([
      expect.objectContaining({ page_changed: true }),
    ]);
    expect(history().actions().size).toBe(actionsBefore + 1);
    const actionId = lastActionId();
    expect(history().actions().get(actionId)).toMatchObject({
      caller: "goalLoop",
      tool: "App.add",
    });
    await expectBeforeChangeAfter(actionId);

    // Step two ran after the step's action: the agent's cursor had not moved.
    expect(agentCursorDuringRun).toBe(agentCursor);
    // The Handover gives the agent the page the model last received.
    expect(history().cursor("agent")).not.toBe(agentCursor);
    expect(names(await history().cursor("agent")!.tree.resolve())).toContain(
      "Added by the action"
    );
  });

  it("renders the agent's first action after a Handover against the Handover's page", async () => {
    let step = 0;
    let agentActionId: StructuralActionId | undefined;
    const decide: GoalLoopDecisionFunction = async (
      request: DecisionRequest
    ): Promise<DecisionResponse> => {
      const first = step++ === 0;
      if (!first) {
        // An agent tool call while the run is pending stays the agent's.
        await act("App.noop", {});
        agentActionId = lastActionId();
      }
      return {
        model: request.model,
        answers: {
          operation: {
            type: "choice",
            choice: first ? "App.add" : "none",
            confidence: 1,
          },
          goal_met: { type: "noul", noul: first ? 0.1 : 0.9 },
        },
      };
    };
    document.body.innerHTML =
      '<main><h1>List</h1><button id="mark">Mark</button></main>';
    document.querySelector("#mark")!.addEventListener("click", () => {
      document
        .querySelector("main")!
        .insertAdjacentHTML("beforeend", "<p>Marked by the agent</p>");
    });
    const currentPage = page;
    class App {
      root = currentPage.locator("main");
      add() {
        document
          .querySelector("main")!
          .insertAdjacentHTML("beforeend", "<p>Added by the action</p>");
      }
      noop() {}
    }
    registerCompiledPom(
      App,
      manifest("App", [action("add", "App.add"), action("noop", "App.noop")])
    );
    startRuntime(decide);
    createPageRegistration(App);
    await publishTools();
    await readStructure();

    await tool("pursue_goal").execute({ goal: "add one", maxSteps: 3 });
    expect(history().actions().get(agentActionId!)?.caller).toBe("agent");

    // A capture Ayme makes for itself: it finds the ref and moves no cursor.
    const [markRef] = (
      await getPageStateForElements([document.querySelector("#mark")!])
    ).refs;
    const result = await act("click_page_state_ref", { ref: markRef });

    expect(result.changes).toContain("Marked by the agent");
    expect(result.changes).not.toContain("Added by the action");
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

function names(tree: StructuralTree): string[] {
  return tree
    .getAllNodes()
    .flatMap((node) => [
      node.name,
      ...node.children.filter((child) => typeof child === "string"),
    ]);
}

function refFor(text: string, accessibleName: string, role = "button") {
  const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = text.match(
    new RegExp(`(?:^|\\s)(e\\d+) ${role} "${escapedName}"`)
  )?.[1];
  if (!ref) throw new Error(`Expected a Structural Ref for ${accessibleName}.`);
  return AriaRefSchema.parse(ref);
}
