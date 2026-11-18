import { expect, test } from "./fixtures";

test("a Page Object Tool marked destructive carries destructiveHint in the MCP tool list and ayme_list_tools, and an unmarked one carries no annotations", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  await page.getByRole("button", { name: "Show basket" }).click();
  await expect.poll(() => agent.pageToolNames()).toContain("Basket.clear");

  const { tools } = await agent.client.listTools();
  const listed = (name: string) => tools.find((tool) => tool.name === name);
  expect(listed("Basket.clear")?.annotations).toEqual({
    destructiveHint: true,
  });
  expect(listed("Basket.readHeading")).not.toHaveProperty("annotations");

  const listing = JSON.parse((await agent.call("ayme_list_tools")).text) as {
    name: string;
    annotations?: unknown;
  }[];
  const inListing = (name: string) =>
    listing.find((tool) => tool.name === name);
  expect(inListing("Basket.clear")?.annotations).toEqual({
    destructiveHint: true,
  });
  expect(inListing("Basket.readHeading")).not.toHaveProperty("annotations");
});
