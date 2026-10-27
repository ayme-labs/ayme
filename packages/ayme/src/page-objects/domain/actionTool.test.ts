import { describe, expect, it } from "vitest";

import {
  actionFacts,
  describeTool,
  inputParameters,
  inputSchemaFor,
  methodArguments,
} from "./actionTool";
import type { ToolManifest, ToolParameter } from "../../shared";

const refs: ToolParameter = {
  name: "refs",
  optional: false,
  schema: { type: "array", items: { type: "string" } },
  rest: true,
};

function tool(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    methodName: "open",
    toolName: "Page.open",
    parameters: [],
    ...overrides,
  };
}

describe("actionFacts", () => {
  it("keeps the author's description and the other Page Objects it returns", () => {
    expect(
      actionFacts(
        tool({
          description: "Open a related POM.",
          returnPoms: ["Page", "FirstReturnPom", "SecondReturnPom"],
        }),
        "Page"
      )
    ).toStrictEqual({
      description: "Open a related POM.",
      returnPoms: ["FirstReturnPom", "SecondReturnPom"],
    });
  });

  it("says nothing for a bare action that returns nothing or itself", () => {
    expect(actionFacts(tool(), "Page")).toStrictEqual({});
    expect(actionFacts(tool({ description: " " }), "Page")).toStrictEqual({});
    expect(actionFacts(tool({ returnPoms: ["Page"] }), "Page")).toStrictEqual(
      {}
    );
  });
});

describe("describeTool", () => {
  // A Page Object Tool by what its author gave it.
  const tools = {
    "no description": { name: "ListPage.clearDone" },
    "a description only": {
      name: "ListPage.clearDone",
      description: "Clear the done items.",
    },
    "returned Page Objects only": {
      name: "ListPage.clearDone",
      returnPoms: ["SettingsPage", "HelpPage"],
    },
    "a description and returned Page Objects": {
      name: "ListPage.clearDone",
      description: "Clear the done items.",
      returnPoms: ["SettingsPage"],
    },
  };

  it.each([
    ["no description", "ayme-mcp", undefined],
    ["no description", "inspector", undefined],
    ["no description", "webmcp", "Run clearDone."],
    ["no description", "goal-loop", "Run clearDone."],
    ["a description only", "ayme-mcp", "Clear the done items."],
    ["a description only", "inspector", "Clear the done items."],
    ["a description only", "webmcp", "Clear the done items."],
    ["a description only", "goal-loop", "Clear the done items."],
    [
      "returned Page Objects only",
      "ayme-mcp",
      "Then shows SettingsPage or HelpPage.",
    ],
    [
      "returned Page Objects only",
      "inspector",
      "Then shows SettingsPage or HelpPage.",
    ],
    [
      "returned Page Objects only",
      "webmcp",
      "Then shows SettingsPage or HelpPage.",
    ],
    [
      "returned Page Objects only",
      "goal-loop",
      "Then shows SettingsPage or HelpPage.",
    ],
    [
      "a description and returned Page Objects",
      "ayme-mcp",
      "Clear the done items. Then shows SettingsPage.",
    ],
    [
      "a description and returned Page Objects",
      "inspector",
      "Clear the done items. Then shows SettingsPage.",
    ],
    [
      "a description and returned Page Objects",
      "webmcp",
      "Clear the done items. Then shows SettingsPage.",
    ],
    [
      "a description and returned Page Objects",
      "goal-loop",
      "Clear the done items. Then shows SettingsPage.",
    ],
  ] as const)("describes a tool with %s to %s as %j", (tool, reader, text) => {
    expect(describeTool(tools[tool], reader)).toBe(text);
  });

  it("runs a tool that is no Page Object action by its whole name", () => {
    expect(describeTool({ name: "snapshot" }, "goal-loop")).toBe(
      "Run snapshot."
    );
  });
});

describe("inputSchemaFor", () => {
  it("puts a literal default in the parameter's schema", () => {
    expect(
      inputSchemaFor([
        { name: "name", optional: false, schema: { type: "string" } },
        {
          name: "type",
          optional: true,
          schema: { type: "string", enum: ["personal", "account", "team"] },
          default: "personal",
        },
      ])
    ).toStrictEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        type: {
          type: "string",
          enum: ["personal", "account", "team"],
          default: "personal",
        },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("lets agents leave out a rest parameter with no minimum", () => {
    expect(inputSchemaFor([refs]).required).toEqual([]);
    expect(inputParameters([refs])[0]?.optional).toBe(true);
  });

  it("requires a rest parameter whose tuple has required elements", () => {
    expect(
      inputSchemaFor([
        {
          name: "args",
          optional: false,
          schema: {
            type: "array",
            prefixItems: [{ type: "string" }, { type: "number" }],
            minItems: 1,
            maxItems: 2,
          },
          rest: true,
        },
      ]).required
    ).toEqual(["args"]);
  });
});

describe("methodArguments", () => {
  it("spreads a rest parameter's list into the remaining arguments", () => {
    expect(
      methodArguments(
        [{ name: "group", optional: false, schema: { type: "number" } }, refs],
        [1, ["a", "b"]]
      )
    ).toEqual([1, "a", "b"]);
  });

  it("passes no arguments for a rest parameter left out", () => {
    expect(methodArguments([refs], [undefined])).toEqual([]);
  });
});
