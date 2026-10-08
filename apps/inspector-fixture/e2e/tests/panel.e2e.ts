import { expect, test } from "e2e";
import { openDogfood, panel } from "./dogfood.ts";

/** Two acts, each one Inspector tool: `Inspector_collapse`, then `Inspector_open`. */
test("collapses the panel to its logo and opens it again", async ({
  app,
  agent,
  screen,
}) => {
  await openDogfood(app);
  await expect(panel(screen)).toBeVisible();

  await agent.act("collapse the panel to its logo");
  await expect(screen.getByRole("button", "Open ayme")).toBeVisible();
  await expect(panel(screen)).toBeHidden();

  await agent.act("open the panel");
  await expect(panel(screen)).toBeVisible();
});
