import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";

import {
  createPage,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "../page-objects";
import type { PomManifest } from "../shared";
import { callers, errorText } from "../shared";
import { rooted } from "../test-utils/pomRoot.testSupport";
import { createAyme } from "./runtime";

// One input check per Run (#895): before any tool runs, the runtime checks
// its input against the tool's published input schema, for every tool kind,
// for top-level and child Runs alike. Missing input is `{}`. The check comes
// after the tool is found and before its availability.

const manifest: PomManifest = {
  className: "InputPage",
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
      toolName: "InputPage.explode",
      description: "Always fails.",
      parameters: [],
    },
    {
      methodName: "addTodo",
      toolName: "InputPage.addTodo",
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
          toolName: "archive",
          description: "Archive the item.",
          parameters: [],
        },
        {
          methodName: "pin",
          toolName: "pin",
          description: "Pin the item.",
          parameters: [
            { name: "top", optional: true, schema: { type: "boolean" } },
          ],
        },
      ],
    },
  ],
};

const pin = vi.fn();

class InputPage {
  readonly items;
  constructor(page: Page) {
    this.items = [rooted(page.locator("#item"), { archive() {}, pin })];
  }
  explode() {
    throw new Error("The page object action exploded.");
  }
  addTodo() {}
}

registerCompiledPom(InputPage, manifest);

describe("the one input check every Run passes, in Chromium", () => {
  let stop: () => void;
  let run: (name: string, input: unknown) => Promise<unknown>;
  /** "ran", or the error text an agent gets. */
  const call = (name: string, input: unknown) =>
    run(name, input).then(() => "ran", errorText);

  beforeEach(async () => {
    // The fixed overlay covers the item, which leaves its tool unavailable.
    document.body.innerHTML = `
      <ul><li id="item">Draft</li></ul>
      <div id="overlay" style="position: fixed; inset: 0"></div>
    `;
    const ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 1000 }),
      goalLoop: () => Promise.reject(new Error("The loop never starts.")),
      customTools: [
        {
          name: "add_untitled",
          description: "Adds a todo without the title it needs.",
          execute: (_target, { run }) => run("InputPage.addTodo", {}),
        },
      ],
    });
    ayme.pom.register(InputPage);
    stop = ayme.start();
    await probeRegisteredPomMembers();
    run = (name, input) =>
      ayme.tools.run(name, input as never, { by: callers.webmcp });
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("refuses an unavailable tool's bad input as bad input", async () => {
    expect(
      await call("InputPage.items.archive", {
        ref: "e404",
        args: {},
        extra: 1,
      })
    ).toBe("ToolInputError: Input property extra is not supported.");
  });

  it("refuses an unavailable tool's good input as unavailable", async () => {
    expect(
      await call("InputPage.items.archive", { ref: "e404", args: {} })
    ).toMatch(/^RuntimeStateError: InputPage\.items\.archive is unavailable/);
  });

  it("names a tool that does not exist before looking at its input", async () => {
    expect(await call("InputPage.nothing", null)).toMatch(
      /^RuntimeStateError: .*InputPage\.nothing/
    );
  });

  it.each([
    [
      "a Page Object tool",
      "InputPage.explode",
      "The page object action exploded.",
    ],
    ["snapshot", "snapshot", "ran"],
    ["navigate_forward", "navigate_forward", "ran"],
  ])("runs %s with missing input as with {}", async (_, name, outcome) => {
    expect(await call(name, undefined)).toBe(outcome);
  });

  it.each([
    ["InputPage.addTodo", "ToolInputError: Input property title is required."],
    ["click", "ToolInputError: Input property target is required."],
    ["add_untitled", "ToolInputError: Input property ref is required."],
    [
      "goal",
      "ToolInputError: Input property goal is required. Input property maxSteps is required.",
    ],
  ])(
    "refuses missing input to %s by naming what it requires",
    async (name, error) => {
      expect(await call(name, undefined)).toBe(error);
    }
  );

  it.each(["InputPage.explode", "snapshot", "click"])(
    "refuses null input to %s",
    async (name) => {
      expect(await call(name, null)).toBe(
        "ToolInputError: Tool input must be an object."
      );
    }
  );

  it("names every problem with goal's input", async () => {
    expect(
      await call("goal", { goal: 1, maxSteps: 0, values: {}, extra: true })
    ).toBe(
      "ToolInputError: Input property goal must be a string. Input property maxSteps must be at least 1. Input property values must have at least 1 entry. Input property extra is not supported."
    );
  });

  it("checks a collection tool's arguments as part of its input", async () => {
    document.querySelector("#overlay")!.remove();
    await probeRegisteredPomMembers();

    expect(
      await call("InputPage.items.archive", { ref: "e404", args: { x: 1 } })
    ).toBe("ToolInputError: Input property args.x is not supported.");
  });

  it("hands a tool only the input properties it checked", async () => {
    document.querySelector("#overlay")!.remove();
    const { structure } = (await run("snapshot", {})) as { structure: string };
    const ref = structure.match(/(e\d+) InputPage\.items\[0\]/)?.[1];
    pin.mockClear();

    // An inherited property is not part of the input the check reads.
    const input = Object.assign(Object.create({ args: { top: "yes" } }), {
      ref,
    });
    expect(await call("InputPage.items.pin", input)).toBe("ran");
    expect(pin).toHaveBeenCalledOnce();
    expect(pin.mock.calls[0]![0]).toBeUndefined();
  });

  it("checks a child Run's input", async () => {
    document.querySelector("#overlay")!.remove();
    const { structure } = (await run("snapshot", {})) as { structure: string };
    const ref = structure.match(/(e\d+) InputPage\.items\[0\]/)?.[1];

    expect(await call("add_untitled", { ref })).toBe(
      "ToolInputError: Input property title is required."
    );
  });
});
