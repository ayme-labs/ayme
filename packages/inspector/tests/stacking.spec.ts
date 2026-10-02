import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import type { LayoutChoice } from "../src/testing";

// E2E: the Inspector stays above, and operable over, the page's own
// positioned UI, while the rest of the page keeps its pointer.

/** Covers the page with a fixed widget at this z-index, counting its clicks. */
async function coverPage(page: Page, zIndex: number) {
  await page.evaluate((zIndex) => {
    const widget = document.createElement("div");
    widget.dataset.pageWidget = "0";
    Object.assign(widget.style, {
      background: "rgb(255, 0, 255)",
      inset: "0",
      position: "fixed",
      zIndex: String(zIndex),
    });
    widget.addEventListener("click", () => {
      widget.dataset.pageWidget = String(Number(widget.dataset.pageWidget) + 1);
    });
    document.body.append(widget);
  }, zIndex);
  return page.locator("[data-page-widget]");
}

/** Whether the Inspector is what the pointer meets at the element's centre. */
async function inspectorIsOnTopAt(page: Page, element: Locator) {
  const box = await element.boundingBox();
  if (!box) throw new Error("The element is not visible.");
  return page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.hasAttribute("data-ayme-inspector-host"),
    [box.x + box.width / 2, box.y + box.height / 2]
  );
}

/** Clicks a corner of the viewport that the element does not cover. */
async function clickOutsideOf(page: Page, element: Locator) {
  const box = await element.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("The element is not visible.");
  const right = viewport.width - 2;
  const bottom = viewport.height - 2;
  const corner = (
    [
      [1, 1],
      [right, 1],
      [1, bottom],
      [right, bottom],
    ] as const
  ).find(
    ([x, y]) =>
      x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height
  );
  if (!corner) throw new Error("The element covers every corner.");
  await page.mouse.click(corner[0], corner[1]);
}

const layouts: LayoutChoice[] = [
  "Dock left",
  "Dock right",
  "Dock to bottom",
  "Floating",
];

for (const zIndex of [50, 101]) {
  test.describe(`over a page widget at z-index ${zIndex}`, () => {
    test("the panel stays on top and its controls work in every layout", async ({
      page,
      inspector,
    }) => {
      await coverPage(page, zIndex);
      const { header } = inspector;

      for (const layout of layouts) {
        await header.layoutMenu.choose(layout);
        await expect.poll(() => header.layoutMenu.current()).toBe(layout);
        expect(await inspectorIsOnTopAt(page, header.title), layout).toBe(true);
      }
    });

    test("the collapsed logo stays on top and opens the panel", async ({
      page,
      inspector,
    }) => {
      await coverPage(page, zIndex);

      await inspector.collapse();
      expect(await inspectorIsOnTopAt(page, inspector.logo.root)).toBe(true);
      await inspector.logo.open();

      await expect(inspector.panel).toBeVisible();
    });

    test("clicks outside the Inspector reach the page in every layout", async ({
      page,
      inspector,
    }) => {
      const widget = await coverPage(page, zIndex);
      let clicks = 0;
      const clickOutside = async (part: Locator) => {
        await clickOutsideOf(page, part);
        clicks += 1;
        await expect(widget).toHaveAttribute(
          "data-page-widget",
          String(clicks)
        );
      };

      for (const layout of layouts) {
        await inspector.header.layoutMenu.choose(layout);
        await expect(inspector.header.layoutMenu.menu).toBeHidden();
        await clickOutside(inspector.panel);
      }
      await inspector.collapse();
      await clickOutside(inspector.logo.root);
    });
  });
}
