import { describe, expect, it } from "vitest";

import {
  inputParameters,
  inputSchemaFor,
  methodArguments,
  toolDescription,
} from "./actionTool";
import type { ToolManifest, ToolParameter } from "./contracts";

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

describe("toolDescription", () => {
  it("says what an action without a description does", () => {
    expect(toolDescription(tool())).toBe("Run open.");
  });

  it("tells agents to pass a rest parameter's arguments as a list", () => {
    expect(
      toolDescription(
        tool({ description: "Take a rest parameter.", parameters: [refs] })
      )
    ).toBe(
      "Take a rest parameter. refs is a rest parameter: pass its arguments as a list."
    );
  });

  it("names the Page Objects an action may return", () => {
    expect(
      toolDescription(
        tool({
          description: "Open a related POM.",
          returnPoms: ["FirstReturnPom", "SecondReturnPom"],
        })
      )
    ).toBe(
      "Open a related POM. Potential return POMs: FirstReturnPom, SecondReturnPom."
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
    ).toEqual({
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
