import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  highlightOf,
  outline,
  placements,
  testIn,
  confirmGoalRecordings,
  INSPECTOR,
} from "./e2e/fixtures";
import type { ListPage } from "./e2e/pom/ListPage";

// E2E: picking a ref by pointing at the fixture page, with the real ListPage
// Page Object and the ayme runtime, in both placements of the Inspector. The
// run card is the single-element Browser Tools' own view.

/**
 * Waits until the page picks too, once picking started in the panel. The
 * panel shows picking at once; the page starts when the request reaches it,
 * which for an Inspector in a window of its own goes through `ayme mcp`.
 */
async function untilThePagePicks(listPage: ListPage) {
  // The page's crosshair cursor.
  await expect.poll(() => listPage.newItemInputCursor()).toBe("crosshair");
}

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("a ref picked by clicking the page is the element the tool acts on", async ({
      browser,
      appView,
      inspector,
      listPage,
    }) => {
      await inspector.tool("fill");
      const fill = inspector.detail.runCard();

      await fill.refField("target").pickOnPage();
      await untilThePagePicks(listPage);
      await listPage.newItemInput.click();
      await expect
        .poll(() => fill.refField("target").value())
        .toMatch(/textbox "New item"$/);
      await fill.run({ text: "Milk" });

      await expect(await listPage.newItemInput.front()).toHaveValue("Milk");

      // The panel's own run, on the element picked.
      await expect
        .poll(() => inspector.runs.latest("fill").caller())
        .toEqual(INSPECTOR);
      const { tool, input } = (await appView.runs()).at(-1)!;
      expect(tool).toBe("fill");
      expect(input).toEqual({
        target: await appView.ref('textbox "New item"'),
        text: "Milk",
      });

      await confirmGoalRecordings(browser);
    });

    test("while picking, the element under the pointer is highlighted", async ({
      browser,
      inspector,
      listPage,
    }) => {
      const click = await inspector.tool("click");

      await click.refField("target").pickOnPage();
      await untilThePagePicks(listPage);
      await listPage.addItemButton.hover();

      // The dashed hover highlight.
      await expect
        .poll(outline(listPage.addItemButton, browser))
        .toBe("dashed");

      await confirmGoalRecordings(browser);
    });

    test("Esc cancels picking, and clicks reach the page again", async ({
      browser,
      page,
      inspector,
      listPage,
    }) => {
      await inspector.tool("click");
      const ref = inspector.detail.runCard().refField("target");
      await ref.pickOnPage();
      await untilThePagePicks(listPage);

      await page.front();
      await browser.keyboard.press("Escape");
      await expect.poll(() => ref.isPicking()).toBe(false);
      await listPage.newItemInput.click();

      await expect(await listPage.newItemInput.front()).toBeFocused();
      expect(await ref.value()).toBeUndefined();

      await confirmGoalRecordings(browser);
    });

    test("fill's structure leaves a button out and offers the text field", async ({
      browser,
      inspector,
    }) => {
      await inspector.tool("fill");
      const ref = inspector.detail.runCard().refField("target");

      await ref.open();

      await expect(
        await ref.nodeNamed("textbox", "New item").front()
      ).toBeEnabled();
      await expect(
        await ref.nodeNamed("button", "Add item").front()
      ).toHaveCount(0);

      await confirmGoalRecordings(browser);
    });

    test("picking a button for fill greys it and doesn't pick it", async ({
      browser,
      inspector,
      listPage,
    }) => {
      await inspector.tool("fill");
      const ref = inspector.detail.runCard().refField("target");
      await ref.pickOnPage();
      await untilThePagePicks(listPage);

      await listPage.addItemButton.hover();
      await expect
        .poll(highlightOf(listPage.addItemButton, browser))
        .toEqual({ style: "dashed", color: "rgb(156, 163, 175)" });
      await listPage.addItemButton.click();

      expect(await ref.isPicking()).toBe(true);
      expect(await ref.value()).toBeUndefined();

      await confirmGoalRecordings(browser);
    });
  });
}
