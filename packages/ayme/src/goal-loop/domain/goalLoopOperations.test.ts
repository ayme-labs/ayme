import { describe, expect, it } from "vitest";
import { requiredParamsOf, specsOfRootedTool } from "./goalLoopOperations";

describe("the parameters an operation requires", () => {
  it("requires a collection tool's ref and the required parameters in its args, whole", () => {
    expect(
      requiredParamsOf(
        [
          { name: "ref", optional: false, schema: { type: "string" } },
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
    ).toEqual(["ref", "args.value", "args.payload"]);
  });

  it("requires a rooted tool's ref, which its schema offers beside the Page Object id", () => {
    expect(
      requiredParamsOf(
        [
          { name: "id", optional: true, schema: { type: "string" } },
          { name: "ref", optional: true, schema: { type: "string" } },
          {
            name: "args",
            optional: true,
            schema: {
              type: "object",
              properties: { note: { type: "string" } },
              required: ["note"],
            },
          },
        ],
        true
      )
    ).toEqual(["ref", "args.note"]);
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
  it("are the ref of one of its roots and the action's own, without the Page Object id", () => {
    const roots = [{ ref: "e2", present: true, available: true }];

    const specs = specsOfRootedTool(
      [
        { name: "id", optional: true, schema: { type: "string" } },
        { name: "ref", optional: true, schema: { type: "string" } },
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
      [["ref"], false],
      [["args", "note"], false],
    ]);
    expect(specs[0]?.closedSet).toEqual({ kind: "instance", roots });
  });
});
