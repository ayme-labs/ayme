import { expect } from "e2e";

import { testIn } from "../e2e/fixtures";

// Goal-driven twin of ../inspector.e2e.ts: the user's steps are agent goals,
// the checks read the page with locators.

const test = testIn("inline");

test("running a Page Object tool from the panel acts on the page", async ({
  agent,
  listPage,
}) => {
  await agent.act("open the {tool} tool", {
    params: { tool: "ListPage.addItem" },
  });
  await agent.act("run it with the text {text}", { params: { text: "Milk" } });

  await expect(
    await listPage.items
      .within((items) => items.filter({ hasText: "Milk" }))
      .front()
  ).toHaveCount(1);
});
