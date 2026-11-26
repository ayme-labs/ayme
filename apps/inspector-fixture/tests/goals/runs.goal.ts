import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { testIn } from "../e2e/fixtures";

// Goal-driven twin of ../runs.e2e.ts: the user's steps in the panel are
// agent goals, the checks read the page with locators.

const test = testIn("inline");

describe("inline", () => {
  test("a collection action runs on the item and choice picked with the mouse", async ({
    agent,
    listPage,
  }) => {
    await listPage.addItem("Milk");
    await listPage.addItem("Eggs");
    await agent.act("open the {tool} tool", {
      params: { tool: "ListItem.mark" },
    });

    await agent.act("pick the {item} item", { params: { item: "Eggs" } });
    await agent.act("switch the arguments editor to JSON");
    await agent.act("switch the arguments editor back to Form");
    await agent.act("set the state to {state}", { params: { state: "done" } });
    await agent.act("run it");

    const item = (text: string) =>
      listPage.items.within((items) => items.filter({ hasText: text }));
    await expect(await item("Eggs").front()).toHaveAttribute(
      "data-state",
      "done"
    );
    await expect(await item("Milk").front()).not.toHaveAttribute("data-state");
  });
});
