import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";

// E2E: the Structure lens on the fixture page, with the real runtime and
// Chromium's own WebMCP.

/** Whether the Inspector highlights an element of the host page. */
function highlighted(element: Locator) {
  return element.evaluate((node) => node.hasAttribute("data-ayme-highlight"));
}

test("hovering a structure node highlights it on the page, and picking it pins the highlight", async ({
  inspector,
  listPage,
}) => {
  await inspector.navigator.showLens("Structure");
  const newItem = inspector.structure.nodeOf("ListPage.newItemInput");

  await newItem.hover();
  await expect.poll(() => highlighted(listPage.newItemInput)).toBe(true);
  await inspector.structure.refreshButton.hover();
  await expect.poll(() => highlighted(listPage.newItemInput)).toBe(false);

  await newItem.click();
  await inspector.structure.refreshButton.hover();
  await expect.poll(() => highlighted(listPage.newItemInput)).toBe(true);
});
