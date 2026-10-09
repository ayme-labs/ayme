import { describe, expect, it } from "vitest";

import { renderPomDefinitions } from "./pomDefinitionText";

describe("renderPomDefinitions", () => {
  it("renders arrays, tuples, maps, unions and null as TypeScript", () => {
    const text = renderPomDefinitions([
      {
        name: "ShapesPage",
        children: [],
        actions: [
          {
            name: "shapes",
            returnPoms: [],
            inputSchema: {
              type: "object",
              properties: {
                tags: { type: "array", items: { type: "string" } },
                labels: {
                  type: "array",
                  items: { type: "string", enum: ["a", "b"] },
                },
                point: {
                  type: "array",
                  prefixItems: [{ type: "number" }, { type: "string" }],
                  minItems: 1,
                  maxItems: 2,
                },
                path: {
                  type: "array",
                  prefixItems: [{ type: "string" }],
                  minItems: 1,
                  items: { type: "number" },
                },
                values: {
                  type: "object",
                  additionalProperties: {
                    anyOf: [{ type: "string" }, { type: "number" }],
                  },
                },
                note: { anyOf: [{ type: "null" }, { type: "string" }] },
              },
              required: ["tags", "labels", "point", "path", "values"],
            },
          },
        ],
      },
    ]);

    expect(text).toBe(
      [
        "ShapesPage",
        '  shapes(tags: string[], labels: ("a" | "b")[], point: [number, string?], path: [string, ...number[]], values: { [key: string]: string | number }, note?: null | string)',
      ].join("\n")
    );
  });
});
