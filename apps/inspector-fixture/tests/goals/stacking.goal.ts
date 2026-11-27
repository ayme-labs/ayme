import { describe, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { testIn, confirmGoalRecordings } from "../e2e/fixtures";
import type { LayoutChoice } from "../e2e/pom/Inspector";
import type { On, Tab } from "../e2e/tab";

// The goal-driven twin of ../stacking.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: the Inspector stays above, and operable over, the page's own
// positioned UI, while the rest of the page keeps its pointer. The click
// Browser Tool reaches page elements under the panel.

const test = testIn("inline");

/** Covers the page with a fixed widget at this z-index, counting its clicks. */
async function coverPage(page: Tab, zIndex: number) {
  await page.front();
  await page.browser.evaluate((zIndex: number) => {
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
    return null;
  }, zIndex);
  return page.locator("[data-page-widget]");
}

/** The centre of an element's box. */
async function centreOf(element: On) {
  const box = await (await element.front()).boundingBox();
  if (!box) throw new Error("The element is not visible.");
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether the Inspector is what the pointer meets at the element's centre. */
async function inspectorIsOnTopAt(browser: Browser, element: On) {
  const { x, y } = await centreOf(element);
  return browser.evaluate(
    ([x, y]: number[]) =>
      document
        .elementFromPoint(x!, y!)
        ?.hasAttribute("data-ayme-inspector-host") ?? false,
    [x, y]
  );
}

/** Clicks a corner of the viewport that the element does not cover. */
async function clickOutsideOf(page: Tab, element: On) {
  const { box } = await centreOf(element);
  const viewport = await page.browser.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
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
  await page.screen.tapAt({ x: corner[0], y: corner[1] });
}

/** Puts a button at this z-index under the element's centre, counting its clicks. */
async function placeButtonUnder(page: Tab, element: On, zIndex: number) {
  const { x, y } = await centreOf(element);
  await page.browser.evaluate(
    ({ x, y, zIndex }: { x: number; y: number; zIndex: number }) => {
      const button = document.createElement("button");
      button.textContent = "Covered button";
      button.dataset.clicks = "0";
      Object.assign(button.style, {
        left: `${x - 60}px`,
        position: "fixed",
        top: `${y - 20}px`,
        height: "40px",
        width: "120px",
        zIndex: String(zIndex),
      });
      button.addEventListener("click", () => {
        button.dataset.clicks = String(Number(button.dataset.clicks) + 1);
      });
      document.body.append(button);
      return null;
    },
    { x, y, zIndex }
  );
  return page.on((screen) => screen.getByRole("button", "Covered button"));
}

const layouts: LayoutChoice[] = [
  "Dock left",
  "Dock right",
  "Dock to bottom",
  "Floating",
];

for (const zIndex of [50, 101]) {
  describe(`over a page widget at z-index ${zIndex}`, () => {
    test("the panel stays on top and its controls work in every layout", async ({
      agent,
      browser,
      page,
      inspector,
    }) => {
      await coverPage(page, zIndex);
      const { header } = inspector;

      for (const layout of layouts) {
        await agent.act("set the layout to {layout}", { params: { layout } });
        await expect.poll(() => header.layoutMenu.current()).toBe(layout);
        expect(await inspectorIsOnTopAt(browser, header.title), layout).toBe(
          true
        );
      }

      await confirmGoalRecordings(browser);
    });

    test("the collapsed logo stays on top and opens the panel", async ({
      agent,
      browser,
      page,
      inspector,
    }) => {
      await coverPage(page, zIndex);

      await agent.act("collapse the panel");
      expect(await inspectorIsOnTopAt(browser, inspector.logo.root)).toBe(true);
      await agent.act("open the panel from the ayme logo");

      await expect(await inspector.panel.front()).toBeVisible();

      await confirmGoalRecordings(browser);
    });

    test("clicks outside the Inspector reach the page in every layout", async ({
      browser,
      agent,
      page,
      inspector,
    }) => {
      const widget = await coverPage(page, zIndex);
      let clicks = 0;
      const clickOutside = async (part: On) => {
        await clickOutsideOf(page, part);
        clicks += 1;
        await expect(await widget.front()).toHaveAttribute(
          "data-page-widget",
          String(clicks)
        );
      };

      for (const layout of layouts) {
        await agent.act("set the layout to {layout}", { params: { layout } });
        await expect(
          await inspector.header.layoutMenu.menu.front()
        ).toBeHidden();
        await clickOutside(inspector.panel);
      }
      await agent.act("collapse the panel");
      await clickOutside(inspector.logo.root);

      await confirmGoalRecordings(browser);
    });

    test("a click Browser Tool reaches a page button under the panel", async ({
      agent,
      appView,
      browser,
      page,
      inspector,
    }) => {
      const button = await placeButtonUnder(page, inspector.panel, zIndex);
      expect(await inspectorIsOnTopAt(browser, button)).toBe(true);

      await appView.run("click", {
        target: await appView.ref('button "Covered button"'),
      });

      await expect(await button.front()).toHaveAttribute("data-clicks", "1");
      expect(await inspectorIsOnTopAt(browser, button)).toBe(true);
      await agent.act("set the layout to {layout}", {
        params: { layout: "Dock left" },
      });
      await expect
        .poll(() => inspector.header.layoutMenu.current())
        .toBe("Dock left");

      await confirmGoalRecordings(browser);
    });
  });
}
