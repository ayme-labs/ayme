import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";

import { createPage } from "./browserPage";
import type { PomManifest } from "./contracts";
import { errorText } from "./errors";
import { agentTools, saveButtonRef } from "./publication.testSupport";
import { registerCompiledPom } from "./registry";
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
  ],
  components: [
    {
      className: "Item",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "archive",
          toolName: "archive",
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
    this.items = [{ root: page.locator("#item"), archive() {} }];
  }
  explode() {
    throw new Error("The page object action exploded.");
  }
}

registerCompiledPom(FailingPage, failingManifest);

describe("tool failures an agent gets, in Chromium", () => {
  let stop: () => void;

  beforeEach(() => {
    // The fixed overlay covers the button, so a click on it times out.
    document.body.innerHTML = `
      <button id="save">Save changes</button>
      <ul><li id="item">Draft</li></ul>
      <div style="position: fixed; inset: 0"></div>
    `;
    const ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 1000 }),
    });
    ayme.pom.register(FailingPage);
    stop = ayme.start();
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
      `RefResolutionError: Cannot click ref "${ref}": removed.`
    );
  });

  it("returns a throwing Page Object tool's message", async () => {
    expect(await agentCall("FailingPage.explode", {}).catch(errorText)).toBe(
      "The page object action exploded."
    );
  });

  it("returns input a Page Object tool's schema rejects as a ToolInputError", async () => {
    expect(
      await agentCall("FailingPage.explode", { extra: true }).catch(errorText)
    ).toMatch(/^ToolInputError: .*extra/);
  });

  it("returns a collection tool's ref that matches no element as a RefResolutionError", async () => {
    // The overlay blocks the item, which leaves its tool unavailable.
    document.querySelector("div")!.remove();
    await expect
      .poll(() => agentTools().names())
      .toContain("FailingPage.items.archive");

    expect(
      await agentCall("FailingPage.items.archive", {
        ref: "e404",
        args: {},
      }).catch(errorText)
    ).toMatch(/^RefResolutionError: .*"e404"/);
  });

  it("returns invalid snapshot input as a ToolInputError", async () => {
    expect(
      await agentCall("snapshot", { names: "x" }).catch(errorText)
    ).toMatch(/^ToolInputError: .*names/);
  });
});
