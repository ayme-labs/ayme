import { describe, expect, it } from "vitest";
import type { PageObjectId } from "../../page-objects/domain";
import { requiredParamsOf, specsOfRootedTool } from "./goalLoopOperations";

describe("the parameters an operation requires", () => {
  it("requires a rooted tool's Page Object id and the required parameters in its args, whole", () => {
    expect(
      requiredParamsOf(
        [
          { name: "id", optional: false, schema: { type: "string" } },
          {
            name: "args",
            optional: false,
            schema: {
              type: "object",
              properties: {
                value: {
                  type: "array",
                  prefixItems: [{ type: "string" }],
                  maxItems: 1,
                },
                payload: { type: "object", properties: {} },
                note: { type: "string" },
              },
              required: ["value", "payload"],
            },
          },
        ],
        true
      )
    ).toEqual(["id", "args.value", "args.payload"]);
  });

  it("requires the parameters that are not optional, outside a collection", () => {
    expect(
      requiredParamsOf(
        [
          { name: "value", optional: false, schema: { type: "string" } },
          { name: "note", optional: true, schema: { type: "string" } },
        ],
        false
      )
    ).toEqual(["value"]);
  });
});

describe("the arguments of a rooted tool", () => {
  it("are the Page Object id of one of its instances and the action's own", () => {
    const roots = [
      {
        id: "po1" as PageObjectId,
        ref: "e2",
        present: true,
        available: true,
      },
    ];

    const specs = specsOfRootedTool(
      [
        { name: "id", optional: false, schema: { type: "string" } },
        {
          name: "args",
          optional: false,
          schema: {
            type: "object",
            properties: { note: { type: "string" } },
            required: ["note"],
          },
        },
      ],
      roots
    );

    expect(specs.map(({ path, optional }) => [path, optional])).toEqual([
      [["id"], false],
      [["args", "note"], false],
    ]);
    expect(specs[0]?.closedSet).toEqual({ kind: "instance", roots });
  });
});
