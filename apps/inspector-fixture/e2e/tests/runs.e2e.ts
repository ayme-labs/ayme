import { expect, test, unique } from "e2e";
import { openDogfood } from "./dogfood.ts";

/**
 * The first two acts are runTool's (served by the shared store on the ayme
 * arm); the third is `Inspector_runs_clear`.
 */
test("Runs shows the run from the panel, and clearing empties it", async ({
  app,
  agent,
  screen,
}) => {
  await openDogfood(app);
  const text = `Bread ${Date.now().toString(36)}`;
  await agent.act("open the {tool} tool's page from the Tools lens", {
    params: { tool: "ListPage.addItem" },
  });
  await agent.act("run it with the text {text}", {
    params: { text: unique(text) },
  });
  const runs = screen.getByRole("region", "Runs");
  await expect(
    screen.getByRole("list", "Items").getByText(text, { exact: true })
  ).toBeVisible();
  await expect(runs.getByRole("list", "Runs timeline")).toContainText([
    "ListPage.addItem",
  ]);

  await agent.act("clear the runs");

  await expect(runs).toContainText(["No runs"]);
  await expect(runs.getByRole("list", "Runs timeline")).toHaveCount(0);
});
