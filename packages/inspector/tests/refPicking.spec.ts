import { expect, test } from "./fixtures";

// E2E: picking a ref by pointing at the fixture page, with the real ListPage
// Page Object, the Ayme runtime and Chromium's own WebMCP. The run card is
// the built-in Ref tools' own view.

test("a ref picked by clicking the page is the element the tool acts on", async ({
  inspector,
  listPage,
}) => {
  const fill = await inspector.tool("fill");

  await fill.refField("target").pickOnPage();
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

  await click.refField("target").pickOnPage();
  await listPage.addItemButton.hover();

  // The dashed hover highlight.
  await expect(listPage.addItemButton).toHaveAttribute("data-ayme-hover");
});

test("Esc cancels picking, and clicks reach the page again", async ({
  page,
  inspector,
  listPage,
}) => {
  const ref = (await inspector.tool("click")).refField("target");
  await ref.pickOnPage();

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
  await ref.pickOnPage();

  await listPage.addItemButton.hover();
  await expect(listPage.addItemButton).toHaveAttribute(
    "data-ayme-pick-unusable"
  );
  await listPage.addItemButton.click();

  expect(await ref.isPicking()).toBe(true);
  expect(await ref.value()).toBeUndefined();
});
