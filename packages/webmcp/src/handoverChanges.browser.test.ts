import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import type { PomManifest, ToolManifest } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import {
  configureGoalLoop,
  getLastGoalLoopRunResult,
  type GoalLoopDecisionFunction,
  type Handover,
} from "./goalLoop";
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

const DIALOG = "Archive options";
const ARCHIVED = "Archived Invoice 7";

describe("Handover changes in Chromium", () => {
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

  /**
   * An inbox whose Page Object opens and closes a dialog and archives an item,
   * with a Refresh button the agent clicks through a Ref Tool.
   */
  async function startInbox(goalLoop: GoalLoopDecisionFunction) {
    document.body.innerHTML = `
      <main>
        <h1>Inbox</h1>
        <ul><li id="invoice">Invoice 7</li></ul>
        <button id="refresh">Refresh</button>
      </main>
    `;
    document.querySelector("#refresh")!.addEventListener("click", () => {
      document
        .querySelector("main")!
        .insertAdjacentHTML("beforeend", '<p role="status">Refreshed</p>');
    });
    const main = () => document.querySelector("main")!;
    const currentPage = page;
    class Inbox {
      root = currentPage.locator("main");
      openDialog() {
        main().insertAdjacentHTML(
          "beforeend",
          `<div role="dialog" aria-label="${DIALOG}"><p>Choose</p></div>`
        );
      }
      closeDialog() {
        document.querySelector('[role="dialog"]')?.remove();
      }
      archive() {
        document.querySelector("#invoice")?.remove();
        main().insertAdjacentHTML("beforeend", `<p>${ARCHIVED}</p>`);
      }
    }
    registerCompiledPom(
      Inbox,
      manifest("Inbox", [
        action("openDialog", "Inbox.openDialog"),
        action("closeDialog", "Inbox.closeDialog"),
        action("archive", "Inbox.archive"),
      ])
    );
    stop = createRuntimeSession({ page: () => page, goalLoop }).start();
    createPageRegistration(Inbox);
    const publication = await synchronizeWebMcpTools({
      async registerTool(registered: PublishedTool) {
        published.set(registered.name, registered);
      },
    });
    disposePublication = publication.dispose;
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

  async function pursue(): Promise<Handover> {
    return (await tool("pursue_goal").execute({
      goal: "archive the invoice",
      maxSteps: 5,
    })) as Handover;
  }

  it("carries only the net change of the run, not a dialog opened and closed on the way", async () => {
    await startInbox(
      operations([
        "Inbox.openDialog",
        "Inbox.closeDialog",
        "Inbox.archive",
        "done",
      ])
    );
    await readStructure();

    const handover = await pursue();

    expect(handover.reason).toBe("done");
    expect(handover.history).toHaveLength(3);
    expect(handover.changes).toContain(ARCHIVED);
    expect(handover.changes).toContain("<removed> listitem: Invoice 7");
    expect(handover.changes).not.toContain(DIALOG);
    // Each executed step's own Change Record stays on the run result.
    const steps = getLastGoalLoopRunResult()!.stepScores;
    expect(steps.map((step) => step.changes !== undefined)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(steps[0]!.changes).toContain(DIALOG);
    expect(steps[1]!.changes).toContain(DIALOG);
    expect(steps[2]!.changes).toContain(ARCHIVED);
    expect(steps[2]!.changes).not.toContain(DIALOG);
  });

  it("carries no changes when the run changed nothing net", async () => {
    await startInbox(
      operations(["Inbox.openDialog", "Inbox.closeDialog", "done"])
    );
    await readStructure();

    const handover = await pursue();

    expect(handover.reason).toBe("done");
    expect(handover.history).toHaveLength(2);
    expect(handover).not.toHaveProperty("changes");
    expect(
      getLastGoalLoopRunResult()!.stepScores.map((step) => step.changes)
    ).toEqual([expect.stringContaining(DIALOG), expect.any(String), undefined]);
  });

  it("does not repeat the run's changes in the agent's next Change Record", async () => {
    await startInbox(operations(["Inbox.archive", "done"]));
    const refreshRef = refFor(await readStructure(), "Refresh");

    const handover = await pursue();
    expect(handover.changes).toContain(ARCHIVED);

    const result = (await tool("click_page_state_ref").execute({
      ref: refreshRef,
    })) as ActionResultShape;

    expect(result.changes).toContain("Refreshed");
    expect(result.changes).not.toContain(ARCHIVED);
    expect(result.changes).not.toContain("Invoice 7");
  });

  it("reports a change the page made on its own when the run executes no action", async () => {
    await startInbox(operations(["done"]));
    await readStructure();
    document
      .querySelector("main")!
      .insertAdjacentHTML("beforeend", '<div role="status">New mail</div>');

    const handover = await pursue();

    expect(handover.reason).toBe("done");
    expect(handover.history).toEqual([]);
    expect(handover.changes).toContain("New mail");
    // The Handover moved the agent's cursor past that change.
    const again = await pursue();
    expect(again).not.toHaveProperty("changes");
  });
});

/**
 * A decision function that runs the listed operations one per step; "done"
 * answers the goal met.
 */
function operations(steps: string[]): GoalLoopDecisionFunction {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const operation = steps[Math.min(step++, steps.length - 1)]!;
    const done = operation === "done";
    return {
      model: request.model,
      answers: {
        operation: {
          type: "choice",
          choice: done ? "none" : operation,
          confidence: 1,
        },
        goal_met: { type: "noul", noul: done ? 0.9 : 0.1 },
      },
    };
  };
}

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
