import { expect, test } from "e2e";
import { lensButton, openDogfood } from "./dogfood.ts";

/**
 * Two acts: `Inspector_navigator_showLens({ name: "Model" })`, then
 * `Inspector_navigator_model_togglePane({ name: "Page object models" })`.
 */
test("the Model lens lists the page's models, and its pane collapses", async ({
  app,
  agent,
  screen,
}) => {
  await openDogfood(app);

  await agent.act("show the {lens} lens", { params: { lens: "Model" } });

  await expect(lensButton(screen, "Model")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const models = screen.getByRole("list", "Page object models", {
    exact: true,
  });
  await expect(models).toContainText(["ListPage"]);
  await expect(models).toContainText(["Inspector"]);

  await agent.act("collapse the Page object models pane");

  await expect(models).toHaveCount(0);
  await expect(screen.getByRole("tree", "Page objects")).toBeVisible();
});
