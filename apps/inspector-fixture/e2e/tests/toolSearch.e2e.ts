import { expect, test } from "e2e";
import { openDogfood } from "./dogfood.ts";

/**
 * Three acts: `Inspector_navigator_showLens`, `Inspector_navigator_search`,
 * then `Inspector_tool`, which clears the search and opens the tool's page.
 */
test("a search in the Tools lens finds a tool, and its page opens", async ({
  app,
  agent,
  screen,
}) => {
  await openDogfood(app);
  await agent.act("show the {lens} lens", { params: { lens: "Tools" } });

  await agent.act("search the active lens for {query}", {
    params: { query: "addItem" },
  });
  const results = screen.getByRole("list", "Search results");
  await expect(results).toContainText(["ListPage.addItem"]);

  await agent.act("open the {tool} tool's page from the Tools lens", {
    params: { tool: "ListPage.addItem" },
  });
  const selected = screen.getByRole("region", "Selected");
  await expect(
    selected.getByRole("heading", "ListPage.addItem", { exact: true })
  ).toBeVisible();
  await expect(results).toHaveCount(0);
});
