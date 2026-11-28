import { expect } from "e2e";

import { confirmGoalRecordings, testIn } from "../e2e/fixtures";

const test = testIn("inline");

test("adds an item", async ({ browser, agent }) => {
  const expected = ["Milk"];
  await agent.act("open the {tool} tool", { params: { tool: "add" } });
  await agent.act("run it with {text}", { params: { text: "Milk" } });
  expect(expected).toEqual(["Milk"]);
  await confirmGoalRecordings(browser);
});
