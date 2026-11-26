import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { highlightOf, outline, placements, testIn } from "../e2e/fixtures";
import type { Agent } from "e2e";

import type { ListPage } from "../e2e/pom/ListPage";

// The goal-driven twin of ../refPicking.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: picking a ref by pointing at the fixture page, with the real ListPage
// Page Object and the ayme runtime, in both placements of the Inspector. The
// run card is the single-element Browser Tools' own view.

/**
 * Starts picking for the run card's `field` and waits until the page picks too. The panel
 * shows picking at once; the page starts when the request reaches it, which
 * for an Inspector in a window of its own goes through `ayme mcp`.
 */
async function pickOnPage(agent: Agent, field: string, listPage: ListPage) {
  await agent.act("start picking the {field} element on the page", {
    params: { field },
  });
  // The page's crosshair cursor.
  await expect.poll(() => listPage.newItemInputCursor()).toBe("crosshair");
}

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("a ref picked by clicking the page is the element the tool acts on", async ({
      agent,
      inspector,
      listPage,
    }) => {
      await agent.act("open the {tool} tool", { params: { tool: "fill" } });
      const fill = inspector.detail.runCard();

      await pickOnPage(agent, "target", listPage);
      await listPage.newItemInput.click();
      await expect
        .poll(() => fill.refField("target").value())
        .toMatch(/textbox "New item"$/);
      await agent.act("run it with the text {text}", {
        params: { text: "Milk" },
      });

      await expect(await listPage.newItemInput.front()).toHaveValue("Milk");
    });

    test("while picking, the element under the pointer is highlighted", async ({
      agent,
      browser,
      listPage,
    }) => {
      await agent.act("open the {tool} tool", { params: { tool: "click" } });

      await pickOnPage(agent, "target", listPage);
      await listPage.addItemButton.hover();

      // The dashed hover highlight.
      await expect
        .poll(outline(listPage.addItemButton, browser))
        .toBe("dashed");
    });

    test("Esc cancels picking, and clicks reach the page again", async ({
      agent,
      browser,
      page,
      inspector,
      listPage,
    }) => {
      await agent.act("open the {tool} tool", { params: { tool: "click" } });
      const ref = inspector.detail.runCard().refField("target");
      await pickOnPage(agent, "target", listPage);

      await page.front();
      await browser.keyboard.press("Escape");
      await expect.poll(() => ref.isPicking()).toBe(false);
      await listPage.newItemInput.click();

      await expect(await listPage.newItemInput.front()).toBeFocused();
      expect(await ref.value()).toBeUndefined();
    });

    test("fill's structure leaves a button out and offers the text field", async ({
      agent,
      inspector,
    }) => {
      await agent.act("open the {tool} tool", { params: { tool: "fill" } });
      const ref = inspector.detail.runCard().refField("target");

      await agent.act("open the {field} element chooser", {
        params: { field: "target" },
      });

      await expect(
        await ref.nodeNamed("textbox", "New item").front()
      ).toBeEnabled();
      await expect(
        await ref.nodeNamed("button", "Add item").front()
      ).toHaveCount(0);
    });

    test("picking a button for fill greys it and doesn't pick it", async ({
      agent,
      browser,
      inspector,
      listPage,
    }) => {
      await agent.act("open the {tool} tool", { params: { tool: "fill" } });
      const ref = inspector.detail.runCard().refField("target");
      await pickOnPage(agent, "target", listPage);

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
