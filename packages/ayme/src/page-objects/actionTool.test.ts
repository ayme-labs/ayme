import { describe, expect, it } from "vitest";

import {
  actionFacts,
  agentDescription,
  inputParameters,
  inputSchemaFor,
  methodArguments,
} from "./actionTool";
import type { ToolManifest, ToolParameter } from "../shared";

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

describe("agentDescription", () => {
  it("says nothing for a tool with nothing to say", () => {
    expect(agentDescription({ name: "Page.items.open" })).toBeUndefined();
  });

  it("runs the action for an adapter that requires a description", () => {
    expect(
      agentDescription({ name: "Page.items.open" }, { required: true })
    ).toBe("Run open.");
  });

  it("names the Page Objects the page shows afterwards", () => {
    expect(
      agentDescription(
        {
          name: "Page.open",
          description: "Open a related POM.",
          returnPoms: ["FirstReturnPom", "SecondReturnPom"],
        },
        { required: true }
      )
    ).toBe("Open a related POM. Then shows FirstReturnPom or SecondReturnPom.");
    expect(
      agentDescription({ name: "Page.open", returnPoms: ["Dialog"] })
    ).toBe("Then shows Dialog.");
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
