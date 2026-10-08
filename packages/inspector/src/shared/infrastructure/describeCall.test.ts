import { expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import type { Locator, Page } from "@playwright/test";

import { describeCall, type CallDescription } from "./describeCall";

const page = createPage() as unknown as Page;
const button = page.locator("button");

/** A description with its locators as strings, to compare. */
function described(...call: Parameters<typeof describeCall>) {
  const description = describeCall(...call);
  if (!description) return description;
  const text = (locator: Locator) => locator.toString();
  const { cue, hitTargets } = description as CallDescription;
  return {
    ...description,
    ...(cue && { cue: text(cue) }),
    hitTargets: hitTargets.map(text),
  };
}

it.each([
  ["locator", "count", []],
  ["locator", "textContent", []],
  ["locator", "getByRole", ["button"]],
  ["locator", "evaluate", [() => 1]],
  ["page", "locator", ["button"]],
  ["page", "waitForTimeout", [10]],
  ["page", "url", []],
  ["locator", "waitFor", [{ state: "attached" }]],
  ["locator", "_expect", ["to.be.visible"]],
  ["locator", "notAMethod", []],
] as const)("runs a %s's %s as it is", (subject, method, args) => {
  const target = subject === "page" ? page : button;
  expect(describeCall(subject, target, method, [...args])).toBeUndefined();
});

it("runs a symbol-keyed call as it is", () => {
  expect(describeCall("locator", button, Symbol.iterator, [])).toBeUndefined();
});

it("hit-tests and cues a locator's click", () => {
  expect(described("locator", button, "click", [])).toEqual({
    cue: "locator('button')",
    hitTargets: ["locator('button')"],
  });
});

it.each(["dblclick", "tap", "check", "uncheck"] as const)(
  "cues a locator's %s",
  (method) => {
    expect(described("locator", button, method, [])?.cue).toBe(
      "locator('button')"
    );
  }
);

it("hit-tests a hover, without a cue", () => {
  expect(described("locator", button, "hover", [])).toEqual({
    hitTargets: ["locator('button')"],
  });
});

it("hit-tests a drag's element and its drop target", () => {
  expect(
    described("locator", button, "dragTo", [page.locator("ul")])?.hitTargets
  ).toEqual(["locator('button')", "locator('ul')"]);
});

it("paces a fill, without hit-testing it", () => {
  expect(described("locator", button, "fill", ["Milk"])).toEqual({
    hitTargets: [],
  });
});

it("acts on the element a Page action's selector names", () => {
  expect(described("page", page, "click", ["button"])).toEqual({
    cue: "locator('button')",
    hitTargets: ["locator('button')"],
  });
  expect(described("page", page, "fill", ["input", "Milk"])).toEqual({
    hitTargets: [],
  });
  expect(
    described("page", page, "dragAndDrop", ["li", "ul"])?.hitTargets
  ).toEqual(["locator('li')", "locator('ul')"]);
});

it("paces a navigation, which acts on no element", () => {
  expect(described("page", page, "goto", ["/list"])).toEqual({
    hitTargets: [],
  });
  expect(described("page", page, "reload", [])).toEqual({ hitTargets: [] });
});

it("paces the keyboard's and the mouse's calls, without a cue", () => {
  expect(described("keyboard", page.keyboard, "press", ["Enter"])).toEqual({
    hitTargets: [],
  });
  expect(described("mouse", page.mouse, "click", [10, 20])).toEqual({
    hitTargets: [],
  });
});
