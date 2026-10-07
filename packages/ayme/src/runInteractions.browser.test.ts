import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import { expect as expectOnPage } from "@ayme-dev/playwright-lite";

import type { PomManifest, ToolManifest } from "./contracts";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import {
  callers,
  createAyme,
  createPage,
  type Ayme,
  type CustomTool,
  type Run,
} from "./index";
import { registerCompiledPom } from "./registry";

// Runtime object seam: each Run in `ayme.runs` lists the Interactions it
// performed itself on the runtime's Page.

const FORM = `
  <main>
    <label>Item <input id="item"></label>
    <button id="add">Add</button>
    <button id="save">Save</button>
  </main>
`;

/** A Page Object whose tools fill the item field and press its buttons. */
class ListPage {
  readonly root;
  readonly item;
  readonly addButton;
  readonly saveButton;
  constructor(readonly page: Page) {
    this.root = page.locator("main");
    this.item = page.locator("#item");
    this.addButton = page.locator("#add");
    this.saveButton = page.locator("#save");
  }
  async add(value: string) {
    await this.item.fill(value);
    await this.addButton.click();
  }
  async save() {
    await this.saveButton.click();
  }
  /** Waits for, scrolls to, focuses and checks the item before it saves. */
  async check() {
    await this.item.waitFor();
    await this.item.scrollIntoViewIfNeeded();
    await this.item.focus();
    await expectOnPage(this.item).toBeVisible();
    await this.item.blur();
    await this.saveButton.click();
  }
}

registerCompiledPom(ListPage, {
  className: "ListPage",
  members: ["root", "item", "addButton", "saveButton"].map((memberName) => ({
    memberName,
    kind: "locator",
    access: "field",
  })) as PomManifest["members"],
  tools: [
    tool("add", "ListPage.add", [
      { name: "value", optional: false, schema: { type: "string" } },
    ]),
    tool("save", "ListPage.save"),
    tool("check", "ListPage.check"),
  ],
  components: [],
});

const ITEM = "locator('#item')";
const ADD = "locator('#add')";
const SAVE = "locator('#save')";

describe("a Run's Interactions, in Chromium", () => {
  let ayme: Ayme;
  let stop: (() => void) | undefined;

  afterEach(() => {
    ayme.pom.unregister(ListPage);
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  /** Starts a session on the form with ListPage registered and live. */
  async function start(options: Parameters<typeof createAyme>[0] = {}) {
    document.body.innerHTML = FORM;
    ayme = createAyme({ pageFactory: () => createPage(), ...options });
    stop = ayme.start();
    ayme.pom.register(ListPage);
    await ayme.tools.run("snapshot", {});
  }

  /** The Runs this test started, past the ones earlier tests left. */
  function runsSince(before: readonly Run[]): readonly Run[] {
    const earlier = new Set(before.map((run) => run.id));
    return ayme.runs.list().filter((run) => !earlier.has(run.id));
  }

  it("lists the fills and clicks a Page Object Tool Run made, in order, with their locators", async () => {
    await start();
    const before = ayme.runs.list();

    await ayme.tools.run("ListPage.add", { value: "Milk" });

    expect(runsSince(before)).toEqual([
      expect.objectContaining({
        tool: "ListPage.add",
        interactions: [
          { operation: "fill", locator: ITEM, value: "Milk" },
          { operation: "click", locator: ADD },
        ],
      }),
    ]);
  });

  it("lists only the inputs a Run gave the page as its Interactions, not its waits, checks, scrolls or focus changes", async () => {
    await start();
    const before = ayme.runs.list();

    await ayme.tools.run("ListPage.check", {});

    expect(runsSince(before)).toEqual([
      expect.objectContaining({
        tool: "ListPage.check",
        interactions: [{ operation: "click", locator: SAVE }],
      }),
    ]);
  });

  it("lists only each Run's own Interactions when two Runs start at the same moment", async () => {
    await start();
    const before = ayme.runs.list();

    await Promise.all([
      ayme.tools.run("ListPage.add", { value: "Eggs" }, { by: "assistant" }),
      ayme.tools.run("ListPage.save", {}, { by: callers.inspector }),
    ]);

    expect(runsSince(before)).toEqual([
      expect.objectContaining({
        by: "assistant",
        interactions: [
          { operation: "fill", locator: ITEM, value: "Eggs" },
          { operation: "click", locator: ADD },
        ],
      }),
      expect.objectContaining({
        by: callers.inspector,
        interactions: [{ operation: "click", locator: SAVE }],
      }),
    ]);
  });

  it("lists a Custom Tool's own page calls as its Interactions, and its child Runs' as theirs", async () => {
    const fillThenSave: CustomTool = {
      name: "fill_then_save",
      description: "Fill the item, save, then point at Add.",
      async execute(_target, { run }) {
        const list = ayme.pom.get(ListPage);
        await list.item.fill("Tea");
        await run("ListPage.save", {});
        await list.addButton.hover();
        return null;
      },
    };
    await start({ customTools: [fillThenSave] });
    const { structure } = await ayme.tools.run("snapshot", {});
    const ref = structure.match(/(e\d+) button "Add"/)![1]!;
    const before = ayme.runs.list();

    await ayme.tools.run("fill_then_save", { ref });

    const [custom, ...children] = runsSince(before);
    expect(custom).toMatchObject({
      tool: "fill_then_save",
      interactions: [
        { operation: "fill", locator: ITEM, value: "Tea" },
        { operation: "hover", locator: ADD },
      ],
    });
    expect(children).toEqual([
      expect.objectContaining({
        tool: "ListPage.save",
        parent: custom!.id,
        interactions: [{ operation: "click", locator: SAVE }],
      }),
    ]);
  });

  it("tells subscribers each time a Run gains an Interaction", async () => {
    await start();
    const before = ayme.runs.list();
    const heard: [string, number][] = [];
    const unsubscribe = ayme.runs.subscribe(() => {
      const [run] = runsSince(before);
      heard.push([run!.status, run!.interactions.length]);
    });

    await ayme.tools.run("ListPage.add", { value: "Milk" });
    unsubscribe();

    expect(heard).toEqual([
      ["running", 0],
      ["running", 1],
      ["running", 2],
      ["succeeded", 2],
    ]);
  });

  it("lists no Interactions for a goal Run, and its steps' Interactions under its child Runs", async () => {
    await start({
      goalLoop: decideSteps([
        { operation: "ListPage.save" },
        { operation: "ListPage.save" },
        { operation: "none", goalMet: 0.9 },
      ]),
    });
    const before = ayme.runs.list();

    await ayme.tools.run("goal", { goal: "save twice", maxSteps: 5 });

    const [goal, ...steps] = runsSince(before);
    expect(goal).toMatchObject({ tool: "goal", interactions: [] });
    expect(steps).toEqual([
      expect.objectContaining({
        tool: "ListPage.save",
        parent: goal!.id,
        interactions: [{ operation: "click", locator: SAVE }],
      }),
      expect.objectContaining({
        tool: "ListPage.save",
        parent: goal!.id,
        interactions: [{ operation: "click", locator: SAVE }],
      }),
    ]);
  });
});

type Step = { operation: string; goalMet?: number };

/**
 * A fake Decision Endpoint: each step chooses `operation`, a tool that takes
 * no input, and scores the goal as met by `goalMet` (0.1 when absent).
 */
function decideSteps(steps: Step[]): GoalLoopDecisionFunction {
  let step = 0;
  return async (request) => {
    const questions = request.questions as Record<
      string,
      { criteria: Record<string, string> }
    >;
    const { criteria } = questions.operation!;
    const { operation, goalMet = 0.1 } = steps[step++]!;
    const choice = Object.keys(criteria).find(
      (key) => key === operation || criteria[key] === operation
    );
    if (choice === undefined)
      throw new Error(
        `No option ${operation} among ${JSON.stringify(criteria)}`
      );
    return {
      model: "fake",
      answers: {
        operation: { type: "choice", choice, confidence: 1 },
        goal_met: { type: "noul", noul: goalMet },
      },
    };
  };
}

function tool(
  methodName: string,
  toolName: string,
  parameters: ToolManifest["parameters"] = []
): ToolManifest {
  return {
    methodName,
    toolName,
    description: methodName,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        parameters.map((parameter) => [parameter.name, parameter.schema])
      ),
      required: parameters.map((parameter) => parameter.name),
      additionalProperties: false,
    },
    parameters,
  };
}
