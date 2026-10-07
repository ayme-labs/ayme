import { expect, test } from "e2e";
import { lensButton, openDogfood } from "./dogfood.ts";

/**
 * One act, `Inspector_navigator_showLens({ name: "Tools" })`. The Tools lens
 * lists the page's tools: the list app's and, on the dogfood page, the
 * Inspector's own.
 */
test("the Tools lens lists the page's Page Object tools", async ({
  app,
  agent,
  screen,
}) => {
  await openDogfood(app);

  await agent.act("show the {lens} lens", { params: { lens: "Tools" } });

  await expect(lensButton(screen, "Tools")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const pageObjectTools = screen.getByRole("list", "Page object tools", {
    exact: true,
  });
  await expect(pageObjectTools).toContainText(["ListPage.addItem"]);
  await expect(pageObjectTools).toContainText(["Inspector.open"]);
});
