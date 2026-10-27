import { describe, expect, it } from "vitest";
import type { Locator, Page } from "@playwright/test";

import {
  elementsOf,
  isInteraction,
  kindOf,
  playwrightCalls,
  valueOf,
  type CallSubject,
} from "./playwrightCalls";

// A Page whose locators are named by their selector, so no browser is needed.
const page = {
  locator: (selector: string) => ({ toString: () => `locator('${selector}')` }),
  keyboard: {},
  mouse: {},
} as unknown as Page;
const button = page.locator("button");
const list = page.locator("ul");

// The Interactions as recorded before the table existed: the inputs a Run
// gives the page, and nothing that reads, waits, asserts, scrolls, moves
// focus, navigates, builds a locator or configures.
const interactions: Record<CallSubject, string[]> = {
  locator: [
    "check",
    "clear",
    "click",
    "dblclick",
    "dispatchEvent",
    "dragTo",
    "drop",
    "fill",
    "hover",
    "press",
    "pressSequentially",
    "selectOption",
    "selectText",
    "setChecked",
    "setInputFiles",
    "tap",
    "type",
    "uncheck",
  ],
  page: [
    "check",
    "click",
    "dblclick",
    "dispatchEvent",
    "dragAndDrop",
    "fill",
    "hover",
    "press",
    "selectOption",
    "setChecked",
    "setInputFiles",
    "tap",
    "type",
    "uncheck",
  ],
  keyboard: ["down", "insertText", "press", "type", "up"],
  mouse: ["click", "dblclick", "down", "move", "up", "wheel"],
};

describe.each(Object.keys(interactions) as CallSubject[])(
  "a %s's calls",
  (subject) => {
    it("counts exactly the inputs as Interactions", () => {
      const recorded = Object.entries(playwrightCalls[subject])
        .filter(([, kind]) => isInteraction(kind))
        .map(([method]) => method);
      expect(recorded).toEqual(interactions[subject]);
    });
  }
);

it("knows no symbol-keyed or unknown method, which runs as it is", () => {
  expect(kindOf("locator", Symbol.iterator)).toBeUndefined();
  expect(kindOf("locator", "notAMethod")).toBeUndefined();
  expect(kindOf("page", "toString")).toBeUndefined();
  expect(kindOf("locator", "click")).toBe("click");
});

it("acts on no element and is no Interaction for a navigation or a focus, and does nothing for a scroll", () => {
  expect(kindOf("page", "goto")).toBe("navigate");
  expect(kindOf("locator", "focus")).toBe("act");
  expect(kindOf("locator", "scrollIntoViewIfNeeded")).toBe("none");
  expect(elementsOf("page", page, "goto", ["/list"])).toEqual([]);
  expect(valueOf("page", "goto", ["/list"])).toBeUndefined();
  expect(elementsOf("page", page, "reload", [])).toEqual([]);
});

it("acts on a locator itself, and on a drag's drop target too", () => {
  expect(elementsOf("locator", button, "click", [])).toEqual([button]);
  expect(elementsOf("locator", button, "click", [{ force: true }])).toEqual([
    button,
  ]);
  expect(valueOf("locator", "click", [{ force: true }])).toEqual({
    force: true,
  });
  expect(elementsOf("locator", button, "dragTo", [list])).toEqual([
    button,
    list,
  ]);
  expect(valueOf("locator", "fill", ["Milk"])).toBe("Milk");
  expect(valueOf("locator", "dragTo", [list])).toBe(list);
  // A drag with no target yet names only its own element.
  expect(elementsOf("locator", button, "dragTo", [])).toEqual([button]);
});

it("acts on the elements a Page action's selectors name, its value after them", () => {
  const text = (elements: Locator[]) => elements.map(String);
  expect(text(elementsOf("page", page, "click", ["button"]))).toEqual([
    "locator('button')",
  ]);
  expect(valueOf("page", "fill", ["input", "Milk"])).toBe("Milk");
  // Only the selector names an element, not the value after it.
  expect(text(elementsOf("page", page, "fill", ["input", "Milk"]))).toEqual([
    "locator('input')",
  ]);
  expect(text(elementsOf("page", page, "dragAndDrop", ["li", "ul"]))).toEqual([
    "locator('li')",
    "locator('ul')",
  ]);
  expect(valueOf("page", "dragAndDrop", ["li", "ul"])).toBeUndefined();
  // A Page action without a selector names no element.
  expect(elementsOf("page", page, "click", [{ force: true }])).toEqual([]);
});

it("acts on no element from the keyboard or the mouse", () => {
  expect(elementsOf("keyboard", page.keyboard, "press", ["Enter"])).toEqual([]);
  expect(valueOf("keyboard", "press", ["Enter"])).toBe("Enter");
  expect(elementsOf("mouse", page.mouse, "click", [10, 20])).toEqual([]);
  expect(valueOf("mouse", "click", [10, 20])).toBe(10);
});
