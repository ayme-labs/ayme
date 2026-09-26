import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// E2E: the Model lens on a fixture page whose Page Object has child Page
// Objects, a collection, and a child that is not on the page, with the Ayme
// runtime and Chromium's own WebMCP.

test.use({ fixturePath: "/models.html" });

/**
 * The Page Object Models get_page_context describes, called over WebMCP the
 * way an agent calls it.
 */
async function modelsAnAgentIsTold(page: Page) {
  const payload = await page.evaluate(async () => {
    type WebMcpTool = { name: string };
    const context = document.modelContext as unknown as {
      getTools(): Promise<WebMcpTool[]>;
      executeTool(tool: WebMcpTool, input: string): Promise<string | null>;
    };
    const tool = (await context.getTools()).find(
      (candidate) => candidate.name === "get_page_context"
    );
    if (!tool) throw new Error("get_page_context is not published.");
    return context.executeTool(tool, "{}");
  });
  const { pomDefinitions } = JSON.parse(payload ?? "null") as {
    pomDefinitions: string;
  };
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

test("hovering a Page Object highlights it on the page, and picking it pins the highlight", async ({
  page,
  inspector,
}) => {
  const secondItem = page.locator("#todo-items > li").nth(1);
  const highlighted = page.locator("[data-ayme-highlight]");
  const object = inspector.navigator.model.object("TodoPage.items[1]");

  await object.hover();
  await expect(secondItem).toHaveAttribute("data-ayme-highlight");
  await expect(highlighted).toHaveCount(1);
  await inspector.header.title.hover();
  await expect(highlighted).toHaveCount(0);

  await object.click();
  await inspector.header.title.hover();

  await expect(secondItem).toHaveAttribute("data-ayme-highlight");
  await expect(highlighted).toHaveCount(1);
});

test("hovering a member highlights it on the page, and clicking it pins the highlight", async ({
  page,
  inspector,
}) => {
  const input = page.locator("#todo-new");
  const highlighted = page.locator("[data-ayme-highlight]");
  await inspector.navigator.model.object("TodoPage").click();
  const member = inspector.detail.model.member("newItemInput");

  await member.hover();
  await expect(input).toHaveAttribute("data-ayme-highlight");
  await expect(highlighted).toHaveCount(1);
  await inspector.header.title.hover();
  await expect(highlighted).toHaveCount(0);

  await member.click();
  await inspector.header.title.hover();

  await expect(input).toHaveAttribute("data-ayme-highlight");
  await expect(highlighted).toHaveCount(1);
});
