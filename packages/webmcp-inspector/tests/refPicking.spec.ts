import { expect, test } from "./fixtures";

// E2E: picking a ref by pointing at the fixture page, with the real ListPage
// Page Object, the Ayme runtime and Chromium's own WebMCP. The run card is
// the built-in Ref tools' own view.

test("a ref picked by clicking the page is the element the tool acts on", async ({
  inspector,
  listPage,
}) => {
  const fill = await inspector.tool("fill_page_state_ref");

  await fill.refField().pickOnPage();
  await listPage.newItemInput.click();
  await expect
    .poll(() => fill.refField().value())
    .toMatch(/textbox "New item"$/);
  await fill.run({ value: "Milk" });

  await expect(listPage.newItemInput).toHaveValue("Milk");
});

test("while picking, the element under the pointer is highlighted", async ({
  inspector,
  listPage,
}) => {
  const click = await inspector.tool("click_page_state_ref");

  await click.refField().pickOnPage();
  await listPage.addItemButton.hover();

  await expect(listPage.addItemButton).toHaveAttribute("data-ayme-highlight");
});

test("Esc cancels picking, and clicks reach the page again", async ({
  page,
  inspector,
  listPage,
}) => {
  const ref = (await inspector.tool("click_page_state_ref")).refField();
  await ref.pickOnPage();

  await page.keyboard.press("Escape");
  await expect.poll(() => ref.isPicking()).toBe(false);
  await listPage.newItemInput.click();

  await expect(listPage.newItemInput).toBeFocused();
  expect(await ref.value()).toBeUndefined();
});
