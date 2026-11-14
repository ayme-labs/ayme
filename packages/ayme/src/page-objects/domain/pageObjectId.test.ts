import type { AriaRef } from "@ayme-dev/core/structural-observation";
import { describe, expect, it } from "vitest";
import {
  pageObjectIdOf,
  parsePageObjectId,
  type PageObjectId,
} from "./pageObjectId";

describe("Page Object id", () => {
  it("reads an id written po<n>", () => {
    expect(parsePageObjectId("po1")).toBe("po1");
    expect(parsePageObjectId("po42")).toBe("po42");
  });

  it.each(["e5", "s_1", "po", "po0", "po01", "PO1", " po1", "po1 ", "f1e2", 1])(
    "reads no id from %j",
    (text) => {
      expect(parsePageObjectId(text)).toBeUndefined();
    }
  );

  it("numbers ids from po1", () => {
    expect(pageObjectIdOf(1)).toBe("po1");
    expect(pageObjectIdOf(12)).toBe("po12");
  });

  it("is a type apart from the Structural Ref's", () => {
    const ref = "e5" as AriaRef;
    const id = pageObjectIdOf(1);
    // @ts-expect-error A Structural Ref is not a Page Object id.
    const fromRef: PageObjectId = ref;
    // @ts-expect-error A Page Object id is not a Structural Ref.
    const fromId: AriaRef = id;
    // @ts-expect-error Nor is a plain string a Page Object id.
    const fromText: PageObjectId = "po1";
    expect([fromRef, fromId, fromText]).toEqual(["e5", "po1", "po1"]);
  });
});
