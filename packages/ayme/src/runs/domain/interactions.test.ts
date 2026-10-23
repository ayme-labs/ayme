import { expect, it } from "vitest";
import type { Page } from "@playwright/test";

import { interactionOf } from "./interactions";

// A Page whose locators are named by their selector, so no browser is needed.
const page = {
  locator: (selector: string) => ({ toString: () => `locator('${selector}')` }),
  keyboard: {},
  mouse: {},
} as unknown as Page;
const button = page.locator("button");

it("records an input on a locator, with its value", () => {
  expect(interactionOf("locator", button, "click", [])).toEqual({
    operation: "click",
    locator: "locator('button')",
  });
  expect(interactionOf("locator", button, "fill", ["Milk"])).toEqual({
    operation: "fill",
    locator: "locator('button')",
    value: "Milk",
  });
});

it("records no read, wait, focus change or navigation", () => {
  expect(interactionOf("locator", button, "count", [])).toBeUndefined();
  expect(interactionOf("locator", button, "focus", [])).toBeUndefined();
  expect(interactionOf("page", page, "goto", ["/list"])).toBeUndefined();
  expect(interactionOf("locator", button, Symbol.iterator, [])).toBeUndefined();
});

it("records a Page input on the element its selector names, with the value after it", () => {
  expect(interactionOf("page", page, "fill", ["input", "Milk"])).toEqual({
    operation: "fill",
    locator: "locator('input')",
    value: "Milk",
  });
  // A drag and drop names two elements and has no value.
  expect(interactionOf("page", page, "dragAndDrop", ["#a", "#b"])).toEqual({
    operation: "dragAndDrop",
    locator: "locator('#a')",
  });
});

it("records a drag on its source, with the drop target as no value", () => {
  expect(
    interactionOf("locator", button, "dragTo", [page.locator("ul")])
  ).toEqual({ operation: "dragTo", locator: "locator('button')" });
});

it("records the keyboard's and the mouse's inputs by device, with no locator", () => {
  expect(interactionOf("keyboard", page.keyboard, "press", ["Enter"])).toEqual({
    operation: "keyboard.press",
    value: "Enter",
  });
  expect(interactionOf("mouse", page.mouse, "click", [10, 20])).toEqual({
    operation: "mouse.click",
  });
});
