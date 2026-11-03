import { describe, expect, it } from "vitest";

import { inputSchemaFor } from "./actionTool";
import {
  renderActionParameters,
  renderPomDefinitions,
} from "./pomDefinitionText";
import type { PomDefinitionAction, ToolParameter } from "../../shared";

function action(
  name: string,
  parameters: readonly ToolParameter[]
): PomDefinitionAction {
  return {
    name,
    returnPoms: [],
    inputSchema: inputSchemaFor(parameters),
    parameters,
  };
}

const shapes: ToolParameter[] = [
  {
    name: "tags",
    optional: false,
    schema: { type: "array", items: { type: "string" } },
  },
  {
    name: "labels",
    optional: false,
    schema: { type: "array", items: { type: "string", enum: ["a", "b"] } },
  },
  {
    name: "point",
    optional: false,
    schema: {
      type: "array",
      prefixItems: [{ type: "number" }, { type: "string" }],
      minItems: 1,
      maxItems: 2,
    },
  },
  {
    name: "path",
    optional: false,
    schema: {
      type: "array",
      prefixItems: [{ type: "string" }],
      minItems: 1,
      items: { type: "number" },
    },
  },
  {
    name: "values",
    optional: false,
    schema: {
      type: "object",
      additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }] },
    },
  },
  {
    name: "note",
    optional: true,
    schema: { anyOf: [{ type: "null" }, { type: "string" }] },
  },
  {
    name: "refs",
    optional: false,
    schema: { type: "array", items: { type: "string" } },
    rest: true,
  },
];

const shapesLine =
  'shapes(tags: string[], labels: ("a" | "b")[], point: [number, string?], path: [string, ...number[]], values: { [key: string]: string | number }, note?: null | string, refs?: string[])';

describe("renderPomDefinitions", () => {
  it("renders arrays, tuples, maps, unions and null as TypeScript", () => {
    expect(
      renderPomDefinitions([
        {
          name: "ShapesPage",
          children: [],
          actions: [action("shapes", shapes)],
        },
      ])
    ).toBe(["ShapesPage", `  ${shapesLine}`].join("\n"));
  });

  it("renders a destructured parameter in the shape of its pattern", () => {
    const text = renderPomDefinitions([
      {
        name: "LoginPage",
        children: [],
        actions: [
          action("signIn", [
            {
              destructured: "object",
              optional: false,
              fields: [
                { name: "email", optional: false, schema: { type: "string" } },
                {
                  name: "password",
                  optional: false,
                  schema: { type: "string" },
                },
              ],
            },
          ]),
          action("search", [
            { name: "query", optional: false, schema: { type: "string" } },
            {
              destructured: "object",
              optional: false,
              fields: [
                {
                  name: "limit",
                  optional: true,
                  schema: { type: "number" },
                  default: 10,
                },
              ],
            },
          ]),
          action("move", [
            {
              destructured: "array",
              optional: false,
              fields: [
                { name: "x", optional: false, schema: { type: "number" } },
                { name: "y", optional: false, schema: { type: "number" } },
              ],
            },
          ]),
          action("follow", [
            {
              destructured: "array",
              optional: true,
              fields: [
                { name: "first", optional: false, schema: { type: "string" } },
                {
                  name: "others",
                  optional: false,
                  schema: { type: "array", items: { type: "string" } },
                  rest: true,
                },
              ],
            },
          ]),
          action("spread", [
            {
              destructured: "array",
              optional: false,
              rest: true,
              fields: [
                { name: "name", optional: false, schema: { type: "string" } },
              ],
            },
          ]),
        ],
      },
    ]);

    expect(text).toBe(
      [
        "LoginPage",
        "  signIn({ email: string; password: string })",
        "",
        "  search(query: string, { limit?: number })",
        "",
        "  move([x: number, y: number])",
        "",
        // An optional pattern's fields may each be left out.
        "  follow([first?: string, ...others: string[]])",
        "",
        "  spread(...[name: string])",
      ].join("\n")
    );
  });
});

describe("renderActionParameters", () => {
  it("renders an input schema's properties as the parameters would read", () => {
    expect(renderActionParameters(inputSchemaFor(shapes))).toBe(
      shapesLine.slice("shapes(".length, -1)
    );
  });
});
