import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { testIn } from "../e2e/fixtures";

// Goal-driven twin of ../toolsLens.e2e.ts: the user's steps are agent goals,
// the checks read the panel with locators. Expected values come from the
// page's runtime, never from the panel.

const test = testIn("inline");

describe("inline", () => {
  test("the Tools lens lists every live tool of the page", async ({
    agent,
    appView,
    screen,
  }) => {
    const liveTools = await appView.tools();

    await agent.act("show the Tools lens");

    const navigator = screen
      .getByRole("complementary", "ayme")
      .getByRole("navigation", "Navigator");
    // Each row's button is named by the tool's whole name.
    for (const { name } of liveTools)
      await expect(navigator.getByRole("button", name)).toBeVisible();
    await expect(navigator.getByRole("listitem")).toHaveCount(liveTools.length);
  });
});
