import { expect } from "e2e";

import { confirmGoalRecordings, testIn } from "./e2e/fixtures";

const test = testIn("inline");

test("adds an item", async ({ browser, inspector }) => {
  const expected = ["Milk"];
  await inspector.tool("add");
  await inspector.detail.card.run("Milk");
  expect(expected).toEqual(["Milk"]);
  await confirmGoalRecordings(browser);
});
