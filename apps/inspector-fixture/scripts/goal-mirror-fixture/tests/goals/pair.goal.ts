import { expect } from "e2e";

import { confirmGoalRecordings, testIn } from "../e2e/fixtures";

const test = testIn("inline");

test("adds an item", async ({ browser, agent }) => {
  const expected = ["Milk"];
  await agent.act("open the add tool");
  await agent.act("run it with Milk");
  expect(expected).toEqual(["Milk"]);
  await confirmGoalRecordings(browser);
});
