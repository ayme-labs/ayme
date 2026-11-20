import { rootId } from "../test-utils/agentCalls.testSupport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";

import {
  createPage,
  probeRegisteredPomMembers,
} from "../page-objects/infrastructure";
import { registerCompiledPom } from "../page-objects/application";
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
    {
      methodName: "signIn",
      toolName: "InputPage.signIn",
      description: "Sign in.",
      // `signIn({ email, password }: Credentials, [x, y]: [number, number])`
      parameters: [
        {
          destructured: "object",
          optional: false,
          fields: [
            { name: "email", optional: false, schema: { type: "string" } },
            { name: "password", optional: false, schema: { type: "string" } },
          ],
        },
        {
          destructured: "array",
          optional: false,
          fields: [
            { name: "x", optional: false, schema: { type: "number" } },
            { name: "y", optional: false, schema: { type: "number" } },
          ],
        },
      ],
    },
    {
      methodName: "save",
      toolName: "InputPage.save",
      description: "Save.",
      // `save({ email, password }: Credentials = defaults)`
      parameters: [
        {
          destructured: "object",
          optional: true,
          fields: [
            { name: "email", optional: false, schema: { type: "string" } },
            { name: "password", optional: false, schema: { type: "string" } },
          ],
        },
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
        {
          methodName: "pin",
          toolName: "Item.pin",
          description: "Pin the item.",
          parameters: [
            { name: "top", optional: true, schema: { type: "boolean" } },
          ],
        },
        {
          methodName: "move",
          toolName: "Item.move",
          description: "Move the item.",
          // `move([x, y]: [number, number] = [0, 0])`
          parameters: [
            {
              destructured: "array",
              optional: true,
              fields: [
                { name: "x", optional: false, schema: { type: "number" } },
                { name: "y", optional: false, schema: { type: "number" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const pin = vi.fn();
const signIn = vi.fn();
const save = vi.fn();
const move = vi.fn();

class InputPage {
  readonly items;
  constructor(page: Page) {
    this.items = [rooted(page.locator("#item"), { archive() {}, pin, move })];
  }
  explode() {
    throw new Error("The page object action exploded.");
  }
  addTodo() {}
  signIn(...args: unknown[]) {
    signIn(...args);
  }
  save(...args: unknown[]) {
    save(...args);
  }
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
      await call("Item.archive", {
        id: "po404404",
        args: {},
        extra: 1,
      })
    ).toBe("ToolInputError: Input property extra is not supported.");
  });

  it("refuses an unavailable tool's good input as unavailable", async () => {
    expect(
      await call("Item.archive", {
        id: await rootId("InputPage.items[0]"),
        args: {},
      })
    ).toMatch(/^RuntimeStateError: Item "po\d+" is unavailable/);
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

    expect(await call("Item.archive", { id: "po404404", args: { x: 1 } })).toBe(
      "ToolInputError: Input property args.x is not supported."
    );
  });

  it("hands a tool only the input properties it checked", async () => {
    document.querySelector("#overlay")!.remove();
    const { structure } = (await run("snapshot", {})) as { structure: string };
    const id = structure.match(/ Item (po\d+)/)?.[1];
    pin.mockClear();

    // An inherited property is not part of the input the check reads.
    const input = Object.assign(Object.create({ args: { top: "yes" } }), {
      id,
    });
    expect(await call("Item.pin", input)).toBe("ran");
    expect(pin).toHaveBeenCalledOnce();
    expect(pin.mock.calls[0]![0]).toBeUndefined();
  });

  it("takes a destructured parameter's fields as input, and calls the action with them collected", async () => {
    expect(await call("InputPage.signIn", { email: "a@b.c", x: 1, y: 2 })).toBe(
      "ToolInputError: Input property password is required."
    );
    expect(signIn).not.toHaveBeenCalled();

    expect(
      await call("InputPage.signIn", {
        email: "a@b.c",
        password: "secret",
        x: 1,
        y: 2,
      })
    ).toBe("ran");
    expect(signIn).toHaveBeenCalledExactlyOnceWith(
      { email: "a@b.c", password: "secret" },
      [1, 2]
    );
  });

  it("takes a defaulted pattern all or nothing", async () => {
    document.querySelector("#overlay")!.remove();
    expect(await call("InputPage.save", { email: "a@b.c" })).toBe(
      "ToolInputError: Input property password is required when email is given."
    );
    expect(save).not.toHaveBeenCalled();
    expect(await call("InputPage.save", {})).toBe("ran");
    expect(save).toHaveBeenCalledExactlyOnceWith(undefined);

    const { structure } = (await run("snapshot", {})) as { structure: string };
    const id = structure.match(/ Item (po\d+)/)?.[1];
    expect(await call("Item.move", { id, args: { y: 2 } })).toBe(
      "ToolInputError: Input property args.x is required when y is given."
    );
    expect(move).not.toHaveBeenCalled();
    expect(await call("Item.move", { id, args: { x: 1, y: 2 } })).toBe("ran");
    expect(move).toHaveBeenCalledExactlyOnceWith([1, 2]);
  });

  it("checks a child Run's input", async () => {
    document.querySelector("#overlay")!.remove();
    const { structure } = (await run("snapshot", {})) as { structure: string };
    const ref = structure.match(/(e\d+) Item\b/)?.[1];

    expect(await call("add_untitled", { ref })).toBe(
      "ToolInputError: Input property title is required."
    );
  });
});
