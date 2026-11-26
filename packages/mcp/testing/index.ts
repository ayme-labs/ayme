// Test support (ADR-0057): a coding agent's side of the Agent Connection
// for Playwright tests, which only tests may import. It starts this package's
// own `ayme mcp` command and uses Playwright's types only; `connectPage`
// receives the test's own `Page`.
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * The server's own tools; every other MCP tool is a tool of the page or of
 * an App Process.
 */
export const SERVER_TOOLS = [
  "ayme_connect",
  "ayme_list_tools",
  "ayme_call",
  "ayme_inspect",
];

/**
 * The file of the built `ayme` command, as a consumer gets it, for tests
 * that run it without an MCP client.
 */
export const aymeCommand = fileURLToPath(
  new URL("../dist/cli.mjs", import.meta.url)
);

/**
 * A free port of the loopback interface, which the system picks outside the
 * ayme MCP server's range of 9350 to 9365, the range a page's auto-pair scan
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
 * Answers the auto-pair scan of every page in `context` as if no ayme MCP
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

/**
 * The revisions of the MCP specification an agent may open with:
 * 2025-11-25, the newest that opens with an `initialize` handshake, and
 * 2026-07-28, whose requests each carry the revision and the client's name.
 */
export const MCP_REVISIONS = ["2025-11-25", "2026-07-28"] as const;
export type McpRevision = (typeof MCP_REVISIONS)[number];

/** Where and how `startAgent` starts its server and opens the conversation. */
export type AgentOptions = {
  /** The folder to start `ayme mcp` in; this process's own by default. */
  cwd?: string;
  /**
   * The revision the agent opens with; 2025-11-25 by default. Under
   * 2026-07-28 it also subscribes to tool list changes once open, as an
   * agent must there to hear them.
   */
  revision?: McpRevision;
};

/** A coding agent's view of its ayme MCP server: an MCP client over stdio. */
export class Agent {
  constructor(
    readonly client: Client,
    private readonly stderr: () => string
  ) {}

  /**
   * Calls `name` and returns the tool's own text, whether it is an error, and
   * the server's note of the tool changes after it, if any.
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
 * process and connects to it. A leading `{ cwd }` starts it in that folder
 * instead of this process's own, and a leading `{ revision }` opens with
 * that revision of the MCP specification (see `AgentOptions`).
 */
export async function startAgent(
  ...args: [AgentOptions, ...string[]] | string[]
): Promise<
  Agent & {
    close(): Promise<void>;
    /** How many `notifications/tools/list_changed` the server has sent. */
    toolListChanges(): number;
  }
> {
  const [first, ...rest] = args;
  const { cwd, revision = "2025-11-25" } =
    typeof first === "object" ? first : {};
  const options = (typeof first === "object" ? rest : args) as string[];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [aymeCommand, "mcp", ...options],
    stderr: "pipe",
    cwd,
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  const client = new Client(
    { name: "ayme-e2e", version: "0.0.0" },
    revision === "2026-07-28"
      ? { versionNegotiation: { mode: { pin: revision } } }
      : undefined
  );
  let toolListChanges = 0;
  client.setNotificationHandler(
    "notifications/tools/list_changed",
    () => void toolListChanges++
  );
  await client.connect(transport);
  if (revision === "2026-07-28")
    await client.listen({ toolsListChanged: true });
  return Object.assign(new Agent(client, () => stderr), {
    close: () => client.close(),
    toolListChanges: () => toolListChanges,
  });
}

/**
 * Asks the agent's server for a connect link to `url`, opens it in `page`
 * and waits until the page's tools are MCP tools: until the server lists
 * `page_objects`, a tool every page offers. Returns the link.
 */
export async function connectPage(
  agent: Agent,
  page: Page,
  url: string,
  { timeout = 15_000 }: { timeout?: number } = {}
): Promise<string> {
  const { text, isError } = await agent.call("ayme_connect", { url });
  if (isError) throw new Error(`ayme_connect failed: ${text}`);
  // The link is the answer's first line; a note may follow it.
  const link = text.split("\n")[0]!;
  await page.goto(link);
  const deadline = Date.now() + timeout;
  while (!(await agent.pageToolNames()).includes("page_objects")) {
    if (Date.now() > deadline)
      throw new Error(
        `The page's tools never reached the agent. Server log:\n${agent.log}`
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return link;
}
