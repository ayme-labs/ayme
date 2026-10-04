import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { test as base, expect } from "@playwright/test";

export { expect };

/** The server's own tools; every other MCP tool is a page tool. */
export const SERVER_TOOLS = ["ayme_connect", "ayme_list_tools", "ayme_call"];

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

/** A coding agent's view of its Ayme MCP server: an MCP client over stdio. */
export class Agent {
  constructor(
    readonly client: Client,
    private readonly stderr: () => string
  ) {}

  /**
   * Calls `name` and returns the tool's own text, whether it is an error, and
   * the server's note of the page's tool changes after it, if any.
   */
  async call(name: string, input: Record<string, unknown> = {}) {
    const result = await this.client.callTool({ name, arguments: input });
    const [own, change] = result.content as { type: string; text?: string }[];
    return {
      text: own?.text ?? "",
      isError: result.isError === true,
      note: change?.text,
    };
  }

  /** The names of the MCP tools the server lists now. */
  async toolNames() {
    const { tools } = await this.client.listTools();
    return tools.map((tool) => tool.name);
  }

  /** The names the server lists now beyond its own tools. */
  async pageToolNames() {
    return (await this.toolNames()).filter(
      (name) => !SERVER_TOOLS.includes(name)
    );
  }

  /** The server's stderr so far, for failure messages. */
  get log() {
    return this.stderr();
  }
}

/**
 * Starts the `ayme mcp` command, with `options` such as `--port`, as a child
 * process and connects to it.
 */
export async function startAgent(...options: string[]): Promise<
  Agent & {
    close(): Promise<void>;
    /** How many `notifications/tools/list_changed` the server has sent. */
    toolListChanges(): number;
  }
> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [command, "mcp", ...options],
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  const client = new Client({ name: "ayme-e2e", version: "0.0.0" });
  let toolListChanges = 0;
  client.setNotificationHandler(
    ToolListChangedNotificationSchema,
    () => void toolListChanges++
  );
  await client.connect(transport);
  return Object.assign(new Agent(client, () => stderr), {
    close: () => client.close(),
    toolListChanges: () => toolListChanges,
  });
}

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
    await use(async (path = "/") => {
      const { text: link, isError } = await agent.call("ayme_connect", {
        url: new URL(path, baseURL).href,
      });
      expect(isError, link).toBe(false);
      await page.goto(link);
      await expect
        .poll(() => agent.pageToolNames(), {
          message: `The page's tools never reached the agent. Server log:\n${agent.log}`,
        })
        .not.toEqual([]);
      return link;
    });
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
