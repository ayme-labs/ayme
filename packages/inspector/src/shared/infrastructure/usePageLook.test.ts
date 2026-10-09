import { expect, it } from "vitest";

import { isInspectorOwnMutation } from "./usePageLook";

// Unit tests: which page changes are the Inspector's own, and so start no
// new look at the page.

const attributeChange = (attributeName: string) =>
  ({
    type: "attributes",
    attributeName,
    target: document.createElement("button"),
  }) as unknown as MutationRecord;

it.each(["data-ayme-highlight", "data-ayme-hover", "data-ayme-pick-unusable"])(
  "counts its own %s attribute as its own change",
  (attribute) => {
    expect(isInspectorOwnMutation(attributeChange(attribute))).toBe(true);
  }
);

it("counts a change inside its host as its own", () => {
  const host = document.createElement("div");
  host.setAttribute("data-ayme-inspector-host", "");
  expect(
    isInspectorOwnMutation({
      type: "childList",
      target: host,
    } as unknown as MutationRecord)
  ).toBe(true);
});

it("counts the page's own changes as the page's", () => {
  expect(isInspectorOwnMutation(attributeChange("class"))).toBe(false);
  expect(isInspectorOwnMutation(attributeChange(""))).toBe(false);
});
