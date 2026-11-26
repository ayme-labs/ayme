import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { outline, placements, reloadFixture, testIn } from "../e2e/fixtures";

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

      // The list can still be settling under a resting pointer, which then
      // hovers another row: hover again until it is this one.
      // Until the test's own timeout, as Playwright's `toPass()` without one.
      await expect
        .poll(
          async () => {
            await agent.act(
              "hover {object} under On this page in the Model lens",
              {
                params: { object: "TodoPage.items[1]" },
              }
            );
            return secondItem();
          },
          { timeout: 30_000 }
        )
        .toBe("dashed");
      await inspector.header.title.hover();
      await expect.poll(secondItem).toBe("none");

      await agent.act("select {object} under On this page in the Model lens", {
        params: { object: "TodoPage.items[1]" },
      });
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await page
          .locator("#todo-items > li")
          .within((rows) => rows.nth(1))
          .front()
      ).waitFor();
      await inspector.header.title.hover();

      await expect.poll(secondItem).toBe("solid");
    });

    test("hovering a member highlights it dashed, beside the selected Page Object's solid highlight", async ({
      agent,
      browser,
      page,
      inspector,
    }) => {
      const item = outline(page.locator("#todo-items > li >> nth=1"), browser);
      const archiveButton = outline(
        page.locator("#todo-items > li >> nth=1 >> .todo-archive"),
        browser
      );
      await agent.act("select {object} under On this page in the Model lens", {
        params: { object: "TodoPage.items[1]" },
      });

      await agent.act("hover its {member} member", {
        params: { member: "archiveButton" },
      });
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (await page.locator("#todo-items > li >> nth=1").front()).waitFor();

      await expect.poll(archiveButton).toBe("dashed");
      await expect.poll(item).toBe("solid");
      await inspector.header.title.hover();
      await expect.poll(archiveButton).toBe("none");
      await expect.poll(item).toBe("solid");
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

      await agent.act("click its {member} member", {
        params: { member: "newItemInput" },
      });
      await inspector.header.title.hover();

      await expect.poll(input).toBe("solid");
      await expect(await detail.title.front()).toHaveText(
        "TodoPage.newItemInput"
      );
      await expect(await detail.fact("On the page").front()).toHaveText(
        "1 match"
      );
    });

    test("the Model lens's panes stay as they were left after a reload", async ({
      agent,
      page,
      inspector,
    }) => {
      const lens = inspector.navigator.model;
      await agent.act("collapse the {pane} pane in the Model lens", {
        params: { pane: "Page object models" },
      });
      await expect(await lens.modelList.front()).toHaveCount(0);

      await reloadFixture(page, "/models.html");

      await expect(await lens.objectTree.front()).toBeVisible();
      await expect(await lens.modelList.front()).toHaveCount(0);
    });
  });
}
