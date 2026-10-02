import type { Locator, Page } from "@playwright/test";

import { AgentView } from "./agentView";
import { expect, test } from "./fixtures";
import type { LayoutChoice } from "../src/testing";

// E2E: the Inspector stays above, and operable over, the page's own
// positioned UI, while the rest of the page keeps its pointer. An agent's
// clicks reach page elements under the panel (#272).

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

/** Puts a button at this z-index under the element's centre, counting its clicks. */
async function placeButtonUnder(page: Page, element: Locator, zIndex: number) {
  const box = await element.boundingBox();
  if (!box) throw new Error("The element is not visible.");
  await page.evaluate(
    ({ x, y, zIndex }) => {
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
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, zIndex }
  );
  return page.getByRole("button", { name: "Covered button" });
}

/** The ref get_page_context gives the element with this role line. */
async function refOf(agent: AgentView, line: string) {
  const { structure } = (await agent.call("get_page_context", {})) as {
    structure: string;
  };
  const ref = structure.match(new RegExp(`(e\\d+) ${line}`))?.[1];
  if (!ref) throw new Error(`No ref for ${line} in:\n${structure}`);
  return ref;
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

    test("an agent's click reaches a page button under the panel", async ({
      page,
      inspector,
    }) => {
      const button = await placeButtonUnder(page, inspector.panel, zIndex);
      expect(await inspectorIsOnTopAt(page, button)).toBe(true);
      const agent = new AgentView(page);

      await agent.call("click_page_state_ref", {
        ref: await refOf(agent, 'button "Covered button"'),
      });

      await expect(button).toHaveAttribute("data-clicks", "1");
      expect(await inspectorIsOnTopAt(page, button)).toBe(true);
      await inspector.header.layoutMenu.choose("Dock left");
      await expect
        .poll(() => inspector.header.layoutMenu.current())
        .toBe("Dock left");
    });
  });
}
