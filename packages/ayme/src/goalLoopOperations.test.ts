import { describe, expect, it } from "vitest";
import { requiredParamsOf } from "./goalLoopOperations";

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
