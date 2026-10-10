import type { Page } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PomManifest, ToolManifest } from "./contracts";
import {
  createAyme,
  createPage,
  type ActionResult,
  type Ayme,
  type CustomTool,
} from "./index";
import { agentTools } from "./publication.testSupport";
import { registerCompiledPom } from "./registry";

// Runtime object seam, with an agent calling through WebMCP (a `webmcp` Run,
// through the publication harness): its call of a Custom Tool answers with a
// Change Record of everything its Run changed, the child Runs it started
// included.

/** A list whose Add button appends the item field's text as a row. */
const LIST = `
  <main>
    <label>Item <input id="item"></label>
    <button id="add">Add</button>
    <ul id="items"></ul>
  </main>
`;

class ListPage {
  readonly root;
  readonly item;
  readonly addButton;
  constructor(readonly page: Page) {
    this.root = page.locator("main");
    this.item = page.locator("#item");
    this.addButton = page.locator("#add");
  }
  async addItem(text: string) {
    await this.item.fill(text);
    await this.addButton.click();
  }
}

const addItem: ToolManifest = {
  methodName: "addItem",
  toolName: "ListPage.addItem",
  description: "Add an item to the list.",
  parameters: [{ name: "text", optional: false, schema: { type: "string" } }],
};

registerCompiledPom(ListPage, {
  className: "ListPage",
  members: ["root", "item", "addButton"].map((memberName) => ({
    memberName,
    kind: "locator",
    access: "field",
  })) as PomManifest["members"],
  tools: [addItem],
  components: [],
});

/** A Custom Tool that does its job only through a child Run. */
const addMilk: CustomTool = {
  name: "add_milk",
  description: "Add Milk to the list.",
  async execute(_target, { run }) {
    return run("ListPage.addItem", { text: "Milk" });
  },
};

describe("a Custom Tool's Change Record, through WebMCP, in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = LIST;
    document.querySelector("#add")!.addEventListener("click", () => {
      const text = document.querySelector<HTMLInputElement>("#item")!.value;
      document
        .querySelector("#items")!
        .insertAdjacentHTML("beforeend", `<li>${text}</li>`);
    });
    ayme = createAyme({
      pageFactory: () => createPage(),
      customTools: [addMilk],
    });
    stop = ayme.start();
    ayme.pom.register(ListPage);
  });

  afterEach(() => {
    ayme.pom.unregister(ListPage);
    stop();
    document.body.innerHTML = "";
  });

  it("covers what the Custom Tool's child Runs changed", async () => {
    const { structure } = (await agentTools().call("snapshot", {})) as {
      structure: string;
    };
    const ref = structure.match(/(e\d+) button "Add"/)![1]!;

    const answer = (await agentTools().call("add_milk", {
      ref,
    })) as ActionResult;

    expect(answer.page_changed).toBe(true);
    expect(answer.changes).toContain("Milk");
    expect(answer.changes).toContain("listitem");
  });
});
