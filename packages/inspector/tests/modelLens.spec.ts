import type { Locator, Page } from "@playwright/test";
import { executePublishedTool } from "@ayme-dev/ayme/testing";

import { expect, openFixture, test } from "./fixtures";

// E2E: the Model lens on a fixture page whose Page Object has child Page
// Objects, a collection, and a child that is not on the page, with the Ayme
// runtime and a recording WebMCP driver.

test.use({ fixturePath: "/models.html" });

/**
 * The Page Object Models get_page_context describes, called over WebMCP the
 * way an agent calls it.
 */
async function modelsAnAgentIsTold(page: Page) {
  const { pomDefinitions } = (await executePublishedTool(
    page,
    "get_page_context"
  )) as { pomDefinitions: string };
  const names = [...pomDefinitions.matchAll(/^POM (\S+)/gm)].map(
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

test("the model list shows every Page Object Model an agent is told about, including those not on the page", async ({
  page,
  inspector,
}) => {
  const described = await modelsAnAgentIsTold(page);

  await expect
    .poll(() => inspector.navigator.model.modelNames())
    .toEqual(described);
});

/** How the page outlines an element: "dashed" hovered, "solid" selected. */
function outline(element: Locator) {
  return () =>
    element.evaluate((target) => getComputedStyle(target).outlineStyle);
}

test("hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid", async ({
  page,
  inspector,
}) => {
  const secondItem = outline(page.locator("#todo-items > li").nth(1));
  const object = inspector.navigator.model.object("TodoPage.items[1]");

  await object.hover();
  await expect.poll(secondItem).toBe("dashed");
  await inspector.header.title.hover();
  await expect.poll(secondItem).toBe("none");

  await object.click();
  await inspector.header.title.hover();

  await expect.poll(secondItem).toBe("solid");
});

test("hovering a member highlights it dashed, beside the selected Page Object's solid highlight", async ({
  page,
  inspector,
}) => {
  const secondRow = page.locator("#todo-items > li").nth(1);
  const item = outline(secondRow);
  const archiveButton = outline(secondRow.locator(".todo-archive"));
  await inspector.navigator.model.object("TodoPage.items[1]").click();

  await inspector.detail.model.member("archiveButton").hover();

  await expect.poll(archiveButton).toBe("dashed");
  await expect.poll(item).toBe("solid");
  await inspector.header.title.hover();
  await expect.poll(archiveButton).toBe("none");
  await expect.poll(item).toBe("solid");
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

test("the Model lens's panes stay as they were left after a reload", async ({
  page,
  inspector,
}) => {
  const lens = inspector.navigator.model;
  await lens.togglePane("Page object models");
  await expect(lens.modelList).toHaveCount(0);

  await openFixture(page, "/models.html", { reload: true });

  await expect(lens.objectTree).toBeVisible();
  await expect(lens.modelList).toHaveCount(0);
});
