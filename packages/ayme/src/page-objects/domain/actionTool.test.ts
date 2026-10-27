import { describe, expect, it } from "vitest";

import {
  actionFacts,
  inputParameters,
  inputSchemaFor,
  methodArguments,
  requiredDescription,
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
      authorDescription: "Open a related POM.",
      agentDescription:
        "Open a related POM. Then shows FirstReturnPom or SecondReturnPom.",
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

  it.each([
    [{ description: "Clear the done items." }, "Clear the done items."],
    [{ returnPoms: ["SettingsPage"] }, "Shows SettingsPage."],
    [
      { returnPoms: ["SettingsPage", "HelpPage"] },
      "Shows SettingsPage or HelpPage.",
    ],
    [
      { description: "Clear the done items.", returnPoms: ["SettingsPage"] },
      "Clear the done items. Then shows SettingsPage.",
    ],
  ] as const)(
    "gives an action with %j the Agent Description %j",
    (given, text) => {
      expect(
        actionFacts(tool(given as Partial<ToolManifest>), "Page")
          .agentDescription
      ).toBe(text);
    }
  );
});

describe("requiredDescription", () => {
  it("is the Agent Description when there is one", () => {
    expect(
      requiredDescription({
        name: "ListPage.clearDone",
        agentDescription: "Shows SettingsPage.",
      })
    ).toBe("Shows SettingsPage.");
  });

  it("runs a tool without one by its action's name", () => {
    expect(requiredDescription({ name: "ListPage.clearDone" })).toBe(
      "Run clearDone."
    );
    expect(requiredDescription({ name: "snapshot" })).toBe("Run snapshot.");
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
