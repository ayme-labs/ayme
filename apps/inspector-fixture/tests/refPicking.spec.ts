import type { RefField } from "@ayme-dev/inspector/testing";

import type { ListPage } from "../pom/ListPage";
import { expect, highlightOf, outline, test } from "./fixtures";

// E2E: picking a ref by pointing at the fixture page, with the real ListPage
// Page Object and the ayme runtime. The run card is the single-element
// Browser Tools' own view.

/**
 * Starts picking with `field` and waits until the page picks too. The panel
 * shows picking at once; the page starts when the request reaches it, which
 * for an Inspector in a window of its own goes through `ayme mcp`.
 */
async function pickOnPage(field: RefField, listPage: ListPage) {
  await field.pickOnPage();
  // The page's crosshair cursor.
  await expect(listPage.newItemInput).toHaveCSS("cursor", "crosshair");
}

test("a ref picked by clicking the page is the element the tool acts on", async ({
  inspector,
  listPage,
}) => {
  const fill = await inspector.tool("fill");

  await pickOnPage(fill.refField("target"), listPage);
  await listPage.newItemInput.click();
  await expect
    .poll(() => fill.refField("target").value())
    .toMatch(/textbox "New item"$/);
  await fill.run({ text: "Milk" });

  await expect(listPage.newItemInput).toHaveValue("Milk");
});

test("while picking, the element under the pointer is highlighted", async ({
  inspector,
  listPage,
}) => {
  const click = await inspector.tool("click");

  await pickOnPage(click.refField("target"), listPage);
  await listPage.addItemButton.hover();

  // The dashed hover highlight.
  await expect.poll(outline(listPage.addItemButton)).toBe("dashed");
});

test("Esc cancels picking, and clicks reach the page again", async ({
  page,
  inspector,
  listPage,
}) => {
  const ref = (await inspector.tool("click")).refField("target");
  await pickOnPage(ref, listPage);

  await page.keyboard.press("Escape");
  await expect.poll(() => ref.isPicking()).toBe(false);
  await listPage.newItemInput.click();

  await expect(listPage.newItemInput).toBeFocused();
  expect(await ref.value()).toBeUndefined();
});

test("fill's structure leaves a button out and offers the text field", async ({
  inspector,
}) => {
  const ref = (await inspector.tool("fill")).refField("target");

  await ref.open();

  await expect(ref.nodeNamed("textbox", "New item")).toBeEnabled();
  await expect(ref.nodeNamed("button", "Add item")).toHaveCount(0);
});

test("picking a button for fill greys it and doesn't pick it", async ({
  inspector,
  listPage,
}) => {
  const ref = (await inspector.tool("fill")).refField("target");
  await pickOnPage(ref, listPage);

  await listPage.addItemButton.hover();
  await expect
    .poll(highlightOf(listPage.addItemButton))
    .toEqual({ style: "dashed", color: "rgb(156, 163, 175)" });
  await listPage.addItemButton.click();

  expect(await ref.isPicking()).toBe(true);
  expect(await ref.value()).toBeUndefined();
});
