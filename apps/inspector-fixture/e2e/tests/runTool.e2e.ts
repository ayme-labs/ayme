import { expect, test, unique } from "e2e";
import { openDogfood } from "./dogfood.ts";

/**
 * Two acts: `Inspector_tool({ name: "ListPage.addItem" })`, then the run
 * card's text field and Run button, which are clicks (RunCard.run is not a
 * tool), so e2e's own cache replays them.
 */
test("running a Page Object tool from the panel acts on the page", async ({
  app,
  agent,
  screen,
}) => {
  await openDogfood(app);
  const text = `Milk ${Date.now().toString(36)}`;

  await agent.act("open the {tool} tool's page from the Tools lens", {
    params: { tool: "ListPage.addItem" },
  });
  await agent.act("run it with the text {text}", {
    params: { text: unique(text) },
  });

  await expect(
    screen.getByRole("list", "Items").getByText(text, { exact: true })
  ).toBeVisible();
});
