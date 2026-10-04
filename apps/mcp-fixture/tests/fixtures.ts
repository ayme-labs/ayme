import { type Agent, connectPage, startAgent } from "@ayme-dev/mcp/testing";
import { test as base, expect } from "@playwright/test";

export { expect };
export { Agent, SERVER_TOOLS, startAgent } from "@ayme-dev/mcp/testing";

export const test = base.extend<{
  agent: Agent;
  /**
   * Asks the agent's server for a connect link to `path` on the fixture app,
   * opens it in the page and waits until the page's tools are MCP tools.
   * Returns the link.
   */
  connect: (path?: string) => Promise<string>;
}>({
  // Playwright reads a fixture's dependencies from this pattern.
  // eslint-disable-next-line no-empty-pattern
  agent: async ({}, use) => {
    const agent = await startAgent();
    try {
      await use(agent);
    } finally {
      await agent.close();
    }
  },
  connect: async ({ agent, page, baseURL }, use) => {
    await use((path = "/") =>
      connectPage(agent, page, new URL(path, baseURL).href)
    );
  },
});
