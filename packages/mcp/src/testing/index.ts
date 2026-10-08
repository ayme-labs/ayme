// The testing entry (ADR-0026): a coding agent's side of the Agent Connection
// for Playwright tests, which only tests may import. It starts this package's
// own `ayme mcp` command and uses Playwright's types only; `connectPage`
// receives the test's own `Page`.
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * The server's own tools; every other MCP tool is a tool of the page or of
 * an App Process.
 */
export const SERVER_TOOLS = ["ayme_connect", "ayme_list_tools", "ayme_call"];

/**
 * The file of the built `ayme` command beside this entry, as a consumer gets
 * it, for tests that run it without an MCP client.
 */
export const aymeCommand = fileURLToPath(new URL("./cli.mjs", import.meta.url));

/**
 * A free port of the loopback interface, which the system picks outside the
 * Ayme MCP server's range of 9350 to 9365, the range a page's auto-pair scan
 * probes. `startAgent("--port", String(await freePort()))` starts a server
 * that no page pairs with by itself.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Answers the auto-pair scan of every page in `context` as if no Ayme MCP
 * server ran, except on the ports in `reachable`, which a test may add to
 * later. A localhost page under test then never pairs by itself with a
 * server another test or suite runs on this machine. The scan probes
 * `ws://127.0.0.1:<port>/probe` on each port from 9350 to 9365. Once a
 * context routes any WebSocket, Playwright relays all of its pages'
 * WebSockets, and a message a page sends as it unloads is lost.
 */
export async function ignoreAutoPairScan(
  context: BrowserContext,
  reachable: ReadonlySet<number> = new Set()
): Promise<void> {
  await context.routeWebSocket(
    (url) =>
      url.hostname === "127.0.0.1" &&
      url.pathname === "/probe" &&
      Number(url.port) >= 9350 &&
      Number(url.port) <= 9365 &&
      !reachable.has(Number(url.port)),
    (socket) => socket.close()
  );
}

/** A coding agent's view of its Ayme MCP server: an MCP client over stdio. */
export class Agent {
  constructor(
    readonly client: Client,
    private readonly stderr: () => string
  ) {}

  /**
   * Calls `name` and returns the tool's own text, whether it is an error, and
   * the server's notes after it, if any, such as of the tool changes, joined
   * by a space.
   */
  async call(name: string, input: Record<string, unknown> = {}) {
    const result = await this.client.callTool({ name, arguments: input });
    const [own, ...notes] = result.content as { type: string; text?: string }[];
    const note = notes.map(({ text }) => text ?? "").join(" ");
    return {
      text: own?.text ?? "",
      isError: result.isError === true,
      note: note === "" ? undefined : note,
    };
  }

  /** The names of the MCP tools the server lists now. */
  async toolNames() {
    const { tools } = await this.client.listTools();
    return tools.map((tool) => tool.name);
  }

  /**
   * The names the server lists now beyond its own tools: the page's and the
   * App Processes'.
   */
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
    args: [aymeCommand, "mcp", ...options],
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
 * and waits until the page's tools are MCP tools: until the server lists
 * `snapshot`, a tool every page offers. Returns the link.
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
  while (!(await agent.pageToolNames()).includes("snapshot")) {
    if (Date.now() > deadline)
      throw new Error(
        `The page's tools never reached the agent. Server log:\n${agent.log}`
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return link;
}
