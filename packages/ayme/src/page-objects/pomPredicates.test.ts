import { describe, expect, it } from "vitest";

import { ayme } from "./decorators";
import { askPredicates } from "./pomPredicates";

describe("asking an instance's predicates", () => {
  class Item {
    archive() {}
    rename() {}
    open() {}
  }
  const decorate = (
    methodName: keyof Item,
    available: () => boolean | string | Promise<boolean | string>
  ) =>
    ayme.action({ available })(
      Item.prototype,
      methodName,
      Object.getOwnPropertyDescriptor(Item.prototype, methodName)!
    );
  decorate("archive", () => "Archived already");
  decorate("rename", async () => {
    throw new Error("No name field");
  });
  const tool = (methodName: string) => ({
    methodName,
    toolName: methodName,
    parameters: [],
  });

  it("records each answer, a thrown error as the reason, and skips actions without one", async () => {
    const answers = await askPredicates(new Item(), [
      tool("archive"),
      tool("rename"),
      tool("open"),
    ]);
    expect([...answers]).toEqual([
      ["archive", { available: false, reason: "Archived already" }],
      ["rename", { available: false, reason: "No name field" }],
    ]);
  });
});
