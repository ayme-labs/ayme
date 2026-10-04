import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
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

/**
 * A free port of the loopback interface that the system picks, outside the
 * server's range of 9350 to 9365.
 */
function freePort() {
  return new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export const test = base.extend<{
  /**
   * The agent's server. It listens outside the range a page's auto-pair scan
   * probes, unless a spec sets `inScanRange`, so a localhost page of another
   * suite running beside this one never pairs with it by itself.
   */
  agent: Awaited<ReturnType<typeof startAgent>>;
  /** Whether the `agent` fixture's server listens in the scanned range. */
  inScanRange: boolean;
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
  /**
   * Whether `scanReaches` routes the scan's probes; on unless a spec turns
   * it off. Once a context routes any WebSocket, Playwright relays every
   * WebSocket of its pages, and a message a page sends as it unloads is
   * lost. A spec whose pages always pair by link, so never scan, turns it
   * off to test what the page says as it leaves.
   */
  limitScan: boolean;
}>({
  limitScan: [true, { option: true }],
  inScanRange: [false, { option: true }],
  agent: async ({ inScanRange }, use) => {
    const agent = await (inScanRange
      ? startAgent()
      : startAgent("--port", String(await freePort())));
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
    async ({ context, limitScan }, use) => {
      const ports = new Set<number>();
      if (!limitScan) return use(ports);
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

/**
 * Calls the fixture's `hold` tool, which never answers, on the "Add item"
 * button of `page`, and waits until the page runs it. Returns the call's
 * pending result as `answer`.
 */
export async function holdCall(
  agent: Agent,
  page: import("@playwright/test").Page
): Promise<{ answer: ReturnType<Agent["call"]> }> {
  const { text: snapshot } = await agent.call("snapshot");
  const ref = /(e\d+) button "Add item"/.exec(
    JSON.parse(snapshot).structure
  )?.[1];
  expect(ref, snapshot).toBeDefined();
  const answer = agent.call("hold", { ref });
  // A test may leave the call in flight; closing the agent then rejects it.
  answer.catch(() => {});
  await expect(page.locator(`html[data-holding="${ref}"]`)).toBeAttached();
  return { answer };
}

/** The JSON answer the server gives a call its page left unanswered. */
export function unanswered(answer: { text: string; isError: boolean }) {
  expect(answer.isError, answer.text).toBe(true);
  return JSON.parse(answer.text) as {
    error: string;
    settled?: false;
    loading?: string;
    tools?: string[];
    next: string;
  };
}
