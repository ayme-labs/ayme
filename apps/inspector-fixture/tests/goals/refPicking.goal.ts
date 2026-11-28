import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  placements,
  testIn,
  confirmGoalRecordings,
  INSPECTOR,
} from "../e2e/fixtures";

import type { ListPage } from "../e2e/pom/ListPage";

// The goal-driven twin of ../refPicking.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
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
      agent,
      inspector,
      listPage,
    }) => {
      await agent.act("open the {tool} tool in the Tools lens", {
        params: { tool: "fill" },
      });
      const fill = inspector.detail.runCard();

      await agent.act("start picking the {field} element on the page", {
        params: { field: "target" },
      });
      await untilThePagePicks(listPage);
      await listPage.newItemInput.click();
      await expect
        .poll(() => fill.refField("target").value())
        .toMatch(/textbox "New item"$/);
      await agent.act("run it with the text {text}", {
        params: { text: "Milk" },
      });

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
  });
}
