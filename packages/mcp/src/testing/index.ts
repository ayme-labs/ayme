// The testing entry (ADR-0026): a coding agent's side of the Agent Connection
// for Playwright tests, which only tests may import. It starts this package's
// own `ayme mcp` command and uses Playwright's types only; `connectPage`
// receives the test's own `Page`.
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "@playwright/test";

/** The server's own tools; every other MCP tool is a page tool. */
export const SERVER_TOOLS = ["ayme_connect", "ayme_list_tools", "ayme_call"];

/** The built `ayme` command beside this entry, as a consumer gets it. */
const command = fileURLToPath(new URL("./cli.mjs", import.meta.url));

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

/**
 * Asks the agent's server for a connect link to `url`, opens it in `page`
 * and waits until the page's tools are MCP tools. Returns the link.
 */
export async function connectPage(
  agent: Agent,
  page: Page,
  url: string,
  { timeout = 15_000 }: { timeout?: number } = {}
): Promise<string> {
  const { text: link, isError } = await agent.call("ayme_connect", { url });
  if (isError) throw new Error(`ayme_connect failed: ${link}`);
  await page.goto(link);
  const deadline = Date.now() + timeout;
  while ((await agent.pageToolNames()).length === 0) {
    if (Date.now() > deadline)
      throw new Error(
        `The page's tools never reached the agent. Server log:\n${agent.log}`
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return link;
}
