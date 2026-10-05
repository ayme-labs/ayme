import { expect, test } from "./fixtures";

test("the server notifies the agent when a page pairs and when it leaves", async ({
  agent,
  page,
  baseURL,
}) => {
  const { text: link } = await agent.call("ayme_connect", {
    url: new URL("/", baseURL).href,
  });
  expect(agent.toolListChanges()).toBe(0);

  await page.goto(link);
  await expect
    .poll(() => agent.toolListChanges(), {
      message: `No tool-list change on pairing. Server log:\n${agent.log}`,
    })
    .toBeGreaterThan(0);
  await expect.poll(() => agent.pageToolNames()).toContain("snapshot");

  const beforeLeaving = agent.toolListChanges();
  await page.close();
  await expect
    .poll(() => agent.toolListChanges())
    .toBeGreaterThan(beforeLeaving);
  expect(await agent.pageToolNames()).toEqual([]);
});
