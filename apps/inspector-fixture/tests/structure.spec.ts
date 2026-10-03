import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";

// E2E: the Structure lens on the fixture page, with the real runtime and
// Chromium's own WebMCP.

/** How the page outlines an element: dashed while hovered, solid selected. */
function outline(element: Locator) {
  return element.evaluate((target) => getComputedStyle(target).outlineStyle);
}

test("hovering a structure node highlights it on the page, and selecting it keeps it highlighted", async ({
  inspector,
  listPage,
}) => {
  await inspector.navigator.showLens("Structure");
  const newItem = inspector.structure.nodeOf("ListPage.newItemInput");

  await newItem.hover();
  await expect.poll(() => outline(listPage.newItemInput)).toBe("dashed");

  await newItem.click();
  await inspector.navigator.searchBox.hover();
  await expect.poll(() => outline(listPage.newItemInput)).toBe("solid");
});

test("a text field's node offers fill, and a button's does not", async ({
  inspector,
}) => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.nodeOf("ListPage.newItemInput").click();
  await expect(inspector.detail.node.tool("fill")).toHaveCount(1);

  await inspector.structure.nodeOf("ListPage.addItemButton").click();
  await expect(inspector.detail.node.tool("click")).toHaveCount(1);
  await expect(inspector.detail.node.tool("fill")).toHaveCount(0);
});
