import type { Page } from "@playwright/test";
import { AppView } from "./appView";
import { expect, outline, test } from "./fixtures";

// E2E: the Model lens on a fixture page whose Page Object has child Page
// Objects, a collection, and a child that is not on the page, with the ayme
// runtime.

test.use({ fixturePath: "/models.html" });

/** The Page Object Models snapshot describes, run by the page's runtime. */
async function modelsSnapshotDescribes(page: Page) {
  const { pomDefinitions } = (await new AppView(page).run("snapshot")) as {
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

test("the model list shows every Page Object Model snapshot describes, including those not on the page", async ({
  page,
  inspector,
}) => {
  const described = await modelsSnapshotDescribes(page);

  await expect
    .poll(() => inspector.navigator.model.modelNames())
    .toEqual(described);
});

test("selecting a Page Object highlights it solid on the page", async ({
  page,
  inspector,
}) => {
  const secondItem = outline(page.locator("#todo-items > li").nth(1));

  await inspector.navigator.model.object("TodoPage.items[1]").click();
  await inspector.header.title.hover();

  await expect.poll(secondItem).toBe("solid");
});

test.describe(() => {
  test.skip(
    ({ placement }) => placement === "external",
    "The hover runs inline only, for the reason modelLens.e2e.ts gives."
  );

  test("hovering a Page Object highlights it dashed on the page, and moving off clears it", async ({
    page,
    inspector,
  }) => {
    const secondItem = outline(page.locator("#todo-items > li").nth(1));

    await inspector.navigator.model.object("TodoPage.items[1]").hover();
    await expect.poll(secondItem).toBe("dashed");
    await inspector.header.title.hover();
    await expect.poll(secondItem).toBe("none");
  });
});

test("clicking a member selects it: the page highlights it solid and the panel shows it", async ({
  page,
  inspector,
}) => {
  const input = outline(page.locator("#todo-new"));
  const { model: detail } = inspector.detail;
  await inspector.navigator.model.object("TodoPage").click();

  await detail.member("newItemInput").click();
  await inspector.header.title.hover();

  await expect.poll(input).toBe("solid");
  await expect(detail.title).toHaveText("TodoPage.newItemInput");
  await expect(detail.fact("On the page")).toHaveText("1 match");
});
