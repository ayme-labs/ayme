import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import type { AppView } from "./e2e/appView";
import { outline, placements, reloadFixture, testIn } from "./e2e/fixtures";
import type { Tab } from "./e2e/tab";

// E2E: the Model lens on a fixture page whose Page Object has child Page
// Objects, a collection, and a child that is not on the page, with the ayme
// runtime, in both placements of the Inspector.

/** The Page Object Models snapshot describes, run by the page's runtime. */
async function modelsSnapshotDescribes(appView: AppView, page: Tab) {
  const { pomDefinitions } = (await appView.run("snapshot")) as {
    pomDefinitions: string;
  };
  const names = [...pomDefinitions.matchAll(/^(\S+)/gm)].map(
    (match) => match[1]!
  );
  // The fixture's point: one model is described but not on the page.
  if (
    !names.includes("ArchiveDialog") ||
    (await page.locator("#todo-archive").count()) !== 0
  )
    throw new Error(
      "The model fixture needs an ArchiveDialog that is described but not on the page."
    );
  return names;
}

for (const placement of placements) {
  const test = testIn(placement, "/models.html");

  describe(placement, () => {
    test("the model list shows every Page Object Model snapshot describes, including those not on the page", async ({
      appView,
      page,
      inspector,
    }) => {
      const described = await modelsSnapshotDescribes(appView, page);

      await expect
        .poll(() => inspector.navigator.model.modelNames())
        .toEqual(described);
    });

    test("hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid", async ({
      browser,
      page,
      inspector,
    }) => {
      const secondItem = outline(
        page.locator("#todo-items > li").within((rows) => rows.nth(1)),
        browser
      );
      const object = inspector.navigator.model.object("TodoPage.items[1]");

      // The list can still be settling under a resting pointer, which then
      // hovers another row: hover again until it is this one.
      // Until the test's own timeout, as Playwright's `toPass()` without one.
      await expect
        .poll(
          async () => {
            await object.hover();
            return secondItem();
          },
          { timeout: 30_000 }
        )
        .toBe("dashed");
      await inspector.header.title.hover();
      await expect.poll(secondItem).toBe("none");

      await object.click();
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
      browser,
      page,
      inspector,
    }) => {
      const item = outline(page.locator("#todo-items > li >> nth=1"), browser);
      const archiveButton = outline(
        page.locator("#todo-items > li >> nth=1 >> .todo-archive"),
        browser
      );
      await inspector.navigator.model.object("TodoPage.items[1]").click();

      await inspector.detail.model.member("archiveButton").hover();
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (await page.locator("#todo-items > li >> nth=1").front()).waitFor();

      await expect.poll(archiveButton).toBe("dashed");
      await expect.poll(item).toBe("solid");
      await inspector.header.title.hover();
      await expect.poll(archiveButton).toBe("none");
      await expect.poll(item).toBe("solid");
    });

    test("clicking a member selects it: the page highlights it solid and the panel shows it", async ({
      browser,
      page,
      inspector,
    }) => {
      const input = outline(page.locator("#todo-new"), browser);
      const { model: detail } = inspector.detail;
      await inspector.navigator.model.object("TodoPage").click();

      await detail.member("newItemInput").click();
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
      page,
      inspector,
    }) => {
      const lens = inspector.navigator.model;
      await lens.togglePane("Page object models");
      await expect(await lens.modelList.front()).toHaveCount(0);

      await reloadFixture(page, "/models.html");

      await expect(await lens.objectTree.front()).toBeVisible();
      await expect(await lens.modelList.front()).toHaveCount(0);
    });
  });
}
