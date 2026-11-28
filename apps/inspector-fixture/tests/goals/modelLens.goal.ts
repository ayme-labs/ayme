import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  outline,
  placements,
  testIn,
  bringPanelToFront,
  confirmGoalRecordings,
  movePointerTo,
} from "../e2e/fixtures";

// The goal-driven twin of ../modelLens.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: the Model lens on a fixture page whose Page Object has child Page
// Objects, a collection, and a child that is not on the page, with the ayme
// runtime, in both placements of the Inspector.

for (const placement of placements) {
  const test = testIn(placement, "/models.html");

  describe(placement, () => {
    test("hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid", async ({
      agent,
      browser,
      page,
      inspector,
    }) => {
      const secondItem = outline(
        page.locator("#todo-items > li").within((rows) => rows.nth(1)),
        browser
      );

      await agent.act(
        'hover the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens',
        {
          params: { item: "[1]", ordinal: "second", collection: "items" },
        }
      );
      await expect.poll(secondItem).toBe("dashed");
      await movePointerTo(inspector.header.title);
      await expect.poll(secondItem).toBe("none");

      await bringPanelToFront(inspector);
      await agent.act(
        'select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens',
        {
          params: { item: "[1]", ordinal: "second", collection: "items" },
        }
      );
      await movePointerTo(inspector.header.title);

      await expect.poll(secondItem).toBe("solid");

      await confirmGoalRecordings(browser);
    });

    test("clicking a member selects it: the page highlights it solid and the panel shows it", async ({
      agent,
      browser,
      page,
      inspector,
    }) => {
      const input = outline(page.locator("#todo-new"), browser);
      const { model: detail } = inspector.detail;
      await agent.act("select {object} under On this page in the Model lens", {
        params: { object: "TodoPage" },
      });

      await agent.act("select its {member} member", {
        params: { member: "newItemInput" },
      });
      await movePointerTo(inspector.header.title);

      await expect.poll(input).toBe("solid");
      await expect(await detail.title.front()).toHaveText(
        "TodoPage.newItemInput"
      );
      await expect(await detail.fact("On the page").front()).toHaveText(
        "1 match"
      );

      await confirmGoalRecordings(browser);
    });
  });
}
