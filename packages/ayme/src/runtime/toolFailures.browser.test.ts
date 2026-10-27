import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";

import {
  createPage,
  probeRegisteredPomMembers,
} from "../page-objects/infrastructure";
import { registerCompiledPom } from "../page-objects/application";
import type { PomManifest } from "../shared";
import { errorText } from "../shared";
import {
  agentTools,
  saveButtonRef,
} from "../test-utils/publication.testSupport";
import { rooted } from "../test-utils/pomRoot.testSupport";
import { createAyme } from "./runtime";

// Runtime object seam: a failing call an agent makes rejects with the error,
// whose text `@ayme-dev/webmcp` returns as the MCP `isError` result in place of
// a bare `UnknownError`. The agent's calls are `webmcp` Runs, through the
// publication harness.

const failingManifest: PomManifest = {
  className: "FailingPage",
  members: [
    {
      memberName: "items",
      kind: "component",
      access: "field",
      componentClassName: "Item",
      collection: true,
    },
  ],
  tools: [
    {
      methodName: "explode",
      toolName: "FailingPage.explode",
      description: "Always fails.",
      parameters: [],
    },
    {
      methodName: "addTodo",
      toolName: "FailingPage.addTodo",
      description: "Add a todo.",
      parameters: [
        { name: "title", optional: false, schema: { type: "string" } },
      ],
    },
  ],
  components: [
    {
      className: "Item",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "archive",
          toolName: "Item.archive",
          description: "Archive the item.",
          parameters: [],
        },
      ],
    },
  ],
};

class FailingPage {
  readonly items;
  constructor(page: Page) {
    this.items = [rooted(page.locator("#item"), { archive() {} })];
  }
  explode() {
    throw new Error("The page object action exploded.");
  }
  addTodo() {}
}

registerCompiledPom(FailingPage, failingManifest);

describe("tool failures an agent gets, in Chromium", () => {
  let stop: () => void;

  beforeEach(async () => {
    // The button sits above the fixed overlay, so a click reaches it, but it
    // is disabled, so the click times out. The overlay covers the item.
    document.body.innerHTML = `
      <button id="save" disabled style="position: relative; z-index: 1">Save changes</button>
      <ul><li id="item">Draft</li></ul>
      <div style="position: fixed; inset: 0"></div>
    `;
    const ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 1000 }),
    });
    ayme.pom.register(FailingPage);
    stop = ayme.start();
    await probeRegisteredPomMembers();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  const agentCall = (name: string, input: unknown) =>
    agentTools().call(name, input);

  it("returns a browser action failure with its name and call log", async () => {
    const ref = await saveButtonRef();

    expect(await agentCall("click", { target: ref }).catch(errorText)).toMatch(
      /^TimeoutError: locator\.click: Timeout 1000ms[\s\S]*Call log:/
    );
  });

  it("returns a ref that no longer matches as a RefResolutionError", async () => {
    const ref = await saveButtonRef();
    document.querySelector("#save")!.remove();

    expect(await agentCall("click", { target: ref }).catch(errorText)).toBe(
      `RefResolutionError: Cannot click ref "${ref}": it is no longer on the page.`
    );
  });

  it("returns a throwing Page Object tool's message", async () => {
    // The agent has the page as it is: nothing changed for the error to add.
    await agentCall("snapshot", {});
    expect(await agentCall("FailingPage.explode", {}).catch(errorText)).toBe(
      "The page object action exploded."
    );
  });

  it("returns input a Page Object tool's schema rejects as a ToolInputError", async () => {
    expect(
      await agentCall("FailingPage.explode", { extra: true }).catch(errorText)
    ).toMatch(/^ToolInputError: .*extra/);
  });

  it("names every problem with a Page Object tool's input", async () => {
    expect(
      await agentCall("FailingPage.addTodo", { name: "x" }).catch(errorText)
    ).toBe(
      "ToolInputError: Input property name is not supported. Input property title is required."
    );
  });

  it("returns a collection tool's ref that matches no element as a RefResolutionError", async () => {
    // The overlay blocks the item, which leaves its tool unavailable.
    document.querySelector("div")!.remove();
    await expect.poll(() => agentTools().names()).toContain("Item.archive");

    expect(
      await agentCall("Item.archive", {
        ref: "e404",
        args: {},
      }).catch(errorText)
    ).toMatch(/^RefResolutionError: .*"e404"/);
  });

  it.each([
    [
      { names: "ListPage", full: true },
      "ToolInputError: Input property names must be an array. Input property full is not supported.",
    ],
    [
      { names: [1] },
      "ToolInputError: Input property names[0] must be a string.",
    ],
    [
      { names: ["ListPage"], full: true },
      "ToolInputError: Input property full is not supported.",
    ],
    [{ depth: 2 }, "ToolInputError: Input property depth is not supported."],
  ])(
    "refuses the snapshot input %j, naming every problem",
    async (input, error) => {
      expect(await agentCall("snapshot", input).catch(errorText)).toBe(error);
    }
  );

  it("runs snapshot with no input or a list of names", async () => {
    for (const input of [
      undefined,
      {},
      { names: [] },
      { names: ["FailingPage"] },
    ])
      expect(await agentCall("snapshot", input)).toHaveProperty("structure");
  });
});
