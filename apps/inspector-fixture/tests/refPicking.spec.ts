import type { RefField } from "@ayme-dev/inspector/testing";

import type { ListPage } from "#pom/ListPage";
import { expect, test } from "./fixtures";

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
