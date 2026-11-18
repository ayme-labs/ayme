import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { highlightOf, outline, placements, testIn } from "./e2e/fixtures";

// E2E: picking a ref by pointing at the fixture page, with the real ListPage
// Page Object and the Ayme runtime, in both placements of the Inspector. The
// run card is the single-element Browser Tools' own view.

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
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

      await expect(await listPage.newItemInput.front()).toHaveValue("Milk");
    });

    test("while picking, the element under the pointer is highlighted", async ({
      browser,
      inspector,
      listPage,
    }) => {
      const click = await inspector.tool("click");

      await click.refField("target").pickOnPage();
      await listPage.addItemButton.hover();

      // The dashed hover highlight.
      await expect
        .poll(outline(listPage.addItemButton, browser))
        .toBe("dashed");
    });

    test("Esc cancels picking, and clicks reach the page again", async ({
      browser,
      page,
      inspector,
      listPage,
    }) => {
      const ref = (await inspector.tool("click")).refField("target");
      await ref.pickOnPage();

      await page.front();
      await browser.keyboard.press("Escape");
      await expect.poll(() => ref.isPicking()).toBe(false);
      await listPage.newItemInput.click();

      await expect(await listPage.newItemInput.front()).toBeFocused();
      expect(await ref.value()).toBeUndefined();
    });

    test("fill's structure leaves a button out and offers the text field", async ({
      inspector,
    }) => {
      const ref = (await inspector.tool("fill")).refField("target");

      await ref.open();

      await expect(
        await ref.nodeNamed("textbox", "New item").front()
      ).toBeEnabled();
      await expect(
        await ref.nodeNamed("button", "Add item").front()
      ).toHaveCount(0);
    });

    test("picking a button for fill greys it and doesn't pick it", async ({
      browser,
      inspector,
      listPage,
    }) => {
      const ref = (await inspector.tool("fill")).refField("target");
      await ref.pickOnPage();

      await listPage.addItemButton.hover();
      await expect
        .poll(highlightOf(listPage.addItemButton, browser))
        .toEqual({ style: "dashed", color: "rgb(156, 163, 175)" });
      await listPage.addItemButton.click();

      expect(await ref.isPicking()).toBe(true);
      expect(await ref.value()).toBeUndefined();
    });
  });
}
