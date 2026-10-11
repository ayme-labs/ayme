import type { Locator, Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { interactionOf } from "./interactions";

/** A Page whose locators print as Playwright's do. */
const page = {
  locator: (selector: string) => ({
    toString: () => `locator('${selector}')`,
  }),
} as unknown as Page;

describe("interactionOf", () => {
  it("records page.dragAndDrop on its source with no value", () => {
    expect(interactionOf("page", page, "dragAndDrop", ["#a", "#b"])).toEqual({
      operation: "dragAndDrop",
      locator: "locator('#a')",
    });
  });

  it("keeps the value of the Page's other inputs", () => {
    expect(interactionOf("page", page, "fill", ["#a", "Milk"])).toEqual({
      operation: "fill",
      locator: "locator('#a')",
      value: "Milk",
    });
  });

  it("records locator.dragTo on its source with no value", () => {
    const source = page.locator("#a");
    const target = page.locator("#b") as Locator;
    expect(interactionOf("locator", source, "dragTo", [target])).toEqual({
      operation: "dragTo",
      locator: "locator('#a')",
    });
  });
});
