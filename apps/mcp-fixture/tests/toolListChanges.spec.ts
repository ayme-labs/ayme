import { MCP_REVISIONS, expect, test } from "./fixtures";

for (const revision of MCP_REVISIONS)
  test.describe(`under MCP revision ${revision}`, () => {
    test.use({ revision });

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
      await expect.poll(() => agent.pageToolNames()).toContain("page_objects");

      const beforeLeaving = agent.toolListChanges();
      await page.close();
      await expect
        .poll(() => agent.toolListChanges())
        .toBeGreaterThan(beforeLeaving);
      expect(await agent.pageToolNames()).toEqual([]);
    });
  });
