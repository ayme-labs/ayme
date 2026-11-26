import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { outline, testIn } from "../e2e/fixtures";

// Goal-driven twin of ../modelLens.e2e.ts: the user's steps are agent goals,
// the checks read the page and the panel with locators.

const test = testIn("inline", "/models.html");

describe("inline", () => {
  test("clicking a member selects it: the page highlights it solid and the panel shows it", async ({
    agent,
    browser,
    page,
    screen,
  }) => {
    const input = outline(page.locator("#todo-new"), browser);
    const panel = screen.getByRole("complementary", "ayme");
    await agent.act("select {object} under On this page in the Model lens", {
      params: { object: "TodoPage" },
    });

    await agent.act("click its {member} member", {
      params: { member: "newItemInput" },
    });
    // Off the member, so its hover's dashed outline gives way to the
    // selection's: moving the pointer is no step of the user's.
    await panel.getByRole("heading", "ayme").hover();

    await expect.poll(input).toBe("solid");
    const detail = panel.getByRole("region", "Selected");
    await expect(detail.getByRole("heading", { level: 3 })).toHaveText(
      "TodoPage.newItemInput"
    );
    await expect(
      detail
        .getByRole("group", "On the page")
        // e2e's role type leaves out `definition`, which its engine matches.
        .getByRole("definition" as never)
    ).toHaveText("1 match");
  });
});
