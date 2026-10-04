import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Agent, connectPage, startAgent } from "@ayme-dev/mcp/testing";
import { test as base, expect } from "@playwright/test";

export { expect };
export { Agent, SERVER_TOOLS, startAgent } from "@ayme-dev/mcp/testing";

/** The `ayme` command of the built `@ayme-dev/mcp`, as a consumer gets it. */
const mcpPackage = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@ayme-dev/mcp"
);
const command = join(
  mcpPackage,
  (
    JSON.parse(readFileSync(join(mcpPackage, "package.json"), "utf8")) as {
      bin: { ayme: string };
    }
  ).bin.ayme
);

export const test = base.extend<{
  agent: Awaited<ReturnType<typeof startAgent>>;
  /**
   * Asks the agent's server for a connect link to `path` on the fixture app,
   * opens it in the page and waits until the page's tools are MCP tools.
   * Returns the link.
   */
  connect: (path?: string) => Promise<string>;
  /**
   * The ports whose Ayme MCP server the page's auto-pair scan can find;
   * none unless a test adds them. It keeps a page from auto-pairing with a
   * server of another test, or of another run on this machine.
   */
  scanReaches: Set<number>;
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
  scanReaches: [
    async ({ context }, use) => {
      const ports = new Set<number>();
      // Answers every other probe of the scan as no Ayme MCP server would.
      await context.routeWebSocket(
        (url) => url.pathname === PROBE_PATH && !ports.has(Number(url.port)),
        (socket) => socket.close()
      );
      await use(ports);
    },
    { auto: true },
  ],
});

/** The path the page's auto-pair scan probes on each port of the range. */
const PROBE_PATH = "/probe";

/** The `ayme` command's file, for tests that run it without an MCP client. */
export { command as aymeCommand };

/** The WebSocket address and port of the agent's server, from its link. */
export async function serverAddress(agent: Agent) {
  const { text } = await agent.call("ayme_connect", {
    url: "http://127.0.0.1/",
  });
  const address = /#ayme=(ws:\/\/127\.0\.0\.1:(\d+))\//.exec(text);
  expect(address, text).not.toBeNull();
  return { address: address![1]!, port: Number(address![2]) };
}
