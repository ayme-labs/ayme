/**
 * Everything the Ayme arms set up before the measured window: the Ayme MCP
 * server the agent talks to, `ayme mcp` from `@ayme-dev/mcp`, paired with a
 * headless browser holding the mission's start page, with the Goal Loop and
 * page objects switches set for the arm. The pairing follows the tab through the screens
 * the task moves it to: the server tells the agent each time the tools change.
 * The arm that adds Ayme's Page Object Tools to Playwright MCP shares the
 * server and the page (`setUpAymePage`) and adds its own browser arguments
 * and a proxy that offers the agent the Page Object Tools alone. The arms
 * that reach the page's tools through Playwright's own WebMCP collection
 * open the same page without a server (`setUpWebMcpPage`), on a Chrome
 * whose WebMCP flag is on.
 *
 * A coding agent normally starts its own `ayme mcp` over stdio, and a tab of
 * the app on localhost pairs with it by itself: it looks for a server when it
 * loads and whenever it gains focus. Claude Code starts its MCP servers only
 * when the agent starts and reads their tool lists at once, so a tab that
 * pairs then would reach the agent through a tool-list change somewhere
 * around its first turn, sometimes before it and sometimes after. So the
 * harness starts the server itself, lets the page pair with it, and hands the
 * server's stdio to Claude Code through a small proxy over a Unix socket: the
 * agent's one MCP server is an `ayme mcp` that lists the page's tools from
 * the agent's first tool list on.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { ArmContext, ArmSetup, McpServer } from "./arms.ts";
import { playwright, viewport, type BrowserContext } from "./browser.ts";
import { withoutClaudeVariables } from "./claude.ts";
import type { StartScreen } from "./missions.ts";
import { labUrl, repoRoot } from "./paths.ts";
import {
  decisionEndpointPrecondition,
  type Precondition,
} from "./preconditions.ts";

export const aymeMcpPackageName = "@ayme-dev/mcp";
const aymeMcpPackagePath = createRequire(import.meta.url).resolve(
  `${aymeMcpPackageName}/package.json`
);
const aymeMcpRoot = path.dirname(aymeMcpPackagePath);
/** The `ayme` command's file, as its `bin` names it; built by `pnpm build`. */
export const aymeMcpCliPath = path.join(aymeMcpRoot, "dist/cli.mjs");

export function aymeMcpVersion(): string {
  const manifest = JSON.parse(readFileSync(aymeMcpPackagePath, "utf8")) as {
    version: string;
  };
  return manifest.version;
}

/** The MCP server's name in the agent's configuration; its tools are `mcp__ayme__<tool>`. */
export const aymeServerName = "ayme";

/** The skill the Ayme arms load: the one this repository ships to consumers, so the eval measures that. */
export const aymeSkillName = "ayme";
export const aymeSkillSource = path.join(repoRoot, "skills", aymeSkillName);

/** Where Claude Code loads user skills from, inside the run's configuration folder. */
export function aymeSkillDirectory(configDir: string) {
  return path.join(configDir, "skills", aymeSkillName);
}

/**
 * The lab app's Goal Loop switch: with this cookie set before the page loads,
 * the page publishes `goal`. Without it the Goal Loop is off.
 */
export const goalLoopCookie = { name: "ayme-lab-goal-loop", value: "on" };

/**
 * The lab app's page objects switch: with this cookie set before the page
 * loads, the page registers no page objects, so it publishes `snapshot` and
 * the Browser Tools but no Page Object Tool. Without it the page objects are on.
 */
export const pageObjectsOffCookie = {
  name: "ayme-lab-page-objects",
  value: "off",
};

/**
 * The Chrome flag that supplies `document.modelContext` natively: the WebMCP
 * API, `registerTool`, `getTools`, `executeTool` and `ontoolchange`, and no
 * `navigator.modelContext`. Without it a Chrome supplies neither, and
 * Playwright MCP and the Playwright CLI supply none either: both read
 * `document.modelContext ?? navigator.modelContext` and collect the tools a
 * page registered there. The lab app's polyfill keeps native WebMCP where
 * present, so the flag changes nothing while the polyfill is loaded and
 * carries the arms that use it once the polyfill is dropped.
 */
export const webMcpFeatureFlag = "--enable-features=WebMCP";

/**
 * How long Claude Code lets one MCP tool call run. The `goal` tool runs the
 * whole Goal Loop inside one call, far beyond any default per-call limit; the
 * server itself waits for the page's answer however long it takes.
 */
export const mcpToolTimeoutMs = 320_000;

/** The ports a page's auto-pair scan probes; the server listens on one of them. */
export const serverPorts = { first: 9350, last: 9365 };

/**
 * A Page Object Tool each start screen publishes: proof that the paired page
 * is that screen with Ayme's tools. Without page objects the proof is
 * `snapshot` and the start page's URL.
 */
export const startScreenTool: Record<StartScreen, string> = {
  editor: "SurveyEditorPage.fillSurveyForm",
  "sign-in": "SignInPage.logIn",
};

/** The sessionStorage key under which a tab keeps its pairing, as `@ayme-dev/mcp` stores it. */
const pairingStorageKey = "ayme:agent-connection";

/**
 * The Unix socket the proxy connects the agent's stdio to. In the temporary
 * folder, since macOS caps a socket path at about 100 bytes and a run folder's
 * path is longer; the run id's random suffix keeps runs apart.
 */
export function agentSocketPath(runId: string) {
  return path.join(os.tmpdir(), `ayme-eval-${runId.slice(-6)}.sock`);
}

export function proxyScriptPath(runDir: string) {
  return path.join(runDir, "ayme-mcp-proxy.cjs");
}

/**
 * The shape of a Page Object Tool's name: `<class>.<action>`, the class a
 * Page Object Action belongs to and the action, both JavaScript identifiers.
 * The marker is the name because the MCP tool list carries nothing else: the
 * server lists a page tool as its name, description and input schema, with
 * no annotation of what published it. Every other tool is told apart by that
 * shape: the server's own `ayme_*` tools, the Browser Tools, `snapshot` and
 * `goal` carry no dot, and a Peek Tool, the one other dotted family, is
 * `peek.<name>` or `peek.node.<name>`. A class named `peek` would be missed;
 * no app names one so.
 */
export const pageObjectToolNamePattern =
  /^(?!peek\.)[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;

export function isPageObjectToolName(name: string): boolean {
  return pageObjectToolNamePattern.test(name);
}

/** The Page Object Tools among a page's tool names. */
export function pageObjectToolNames(names: string[]): string[] {
  return names.filter(isPageObjectToolName);
}

/**
 * The command Claude Code starts as the agent's MCP server: forwards its
 * stdio to the `ayme mcp` the harness started and paired before the agent,
 * through the socket named on its command line. With `pageObjectToolsOnly`
 * it reads the newline-delimited JSON-RPC messages instead of piping bytes:
 * a `tools/list` answer keeps the Page Object Tools alone, a `tools/call` of
 * any other tool is answered with a JSON-RPC error and never forwarded, and
 * everything else, `notifications/tools/list_changed` included, passes
 * through unchanged. The server itself is not told; it still lists and would
 * run every tool.
 */
export function proxyScript(
  options: { pageObjectToolsOnly: boolean } = { pageObjectToolsOnly: false }
) {
  return `// Written by the eval harness for one run. Claude Code starts this as the agent's MCP server command;
// it forwards the agent's stdio to the ayme mcp server the harness started and paired before the agent.
// With pageObjectToolsOnly it offers the agent the page's Page Object Tools alone; see the harness's ayme.ts.
const net = require("node:net");
const { StringDecoder } = require("node:string_decoder");
const pageObjectToolsOnly = ${JSON.stringify(options.pageObjectToolsOnly)};
const pageObjectToolName = /${pageObjectToolNamePattern.source}/;
const socket = net.connect(process.argv[2]);

// Calls fn with each newline-delimited line of the stream, whole, whatever the chunks were.
function forEachLine(stream, fn) {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  stream.on("data", (chunk) => {
    rest += decoder.write(chunk);
    let newline;
    while ((newline = rest.indexOf("\\n")) !== -1) {
      fn(rest.slice(0, newline));
      rest = rest.slice(newline + 1);
    }
  });
  stream.on("end", () => {
    if (rest) fn(rest);
  });
}

function parse(line) {
  try {
    const message = JSON.parse(line);
    return message && typeof message === "object" ? message : null;
  } catch {
    return null;
  }
}

function filtered() {
  // The ids of the agent's tools/list requests whose answers are still to come.
  const listRequests = new Set();
  forEachLine(process.stdin, (line) => {
    const message = parse(line);
    if (message?.method === "tools/list" && message.id !== undefined)
      listRequests.add(JSON.stringify(message.id));
    if (message?.method === "tools/call") {
      const name = message.params?.name;
      if (typeof name !== "string" || !pageObjectToolName.test(name)) {
        if (message.id !== undefined)
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32602, message: \`Unknown tool "\${name}".\` },
            }) + "\\n"
          );
        return;
      }
    }
    socket.write(line + "\\n");
  });
  forEachLine(socket, (line) => {
    const message = parse(line);
    if (
      message?.id !== undefined &&
      listRequests.delete(JSON.stringify(message.id)) &&
      Array.isArray(message.result?.tools)
    ) {
      message.result.tools = message.result.tools.filter((tool) =>
        pageObjectToolName.test(tool?.name)
      );
      process.stdout.write(JSON.stringify(message) + "\\n");
      return;
    }
    process.stdout.write(line + "\\n");
  });
}

socket.on("connect", () => {
  if (pageObjectToolsOnly) {
    filtered();
    return;
  }
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on("error", (error) => {
  process.stderr.write(\`ayme-mcp-proxy: \${error.message}\\n\`);
  process.exit(1);
});
socket.on("close", () => process.exit(0));
process.stdin.on("end", () => socket.end());
`;
}

/** The agent's MCP server entry: the proxy to the server the setup starts. */
export function aymeMcpServer(
  context: Pick<ArmContext, "runId" | "runDir">
): McpServer {
  return {
    command: process.execPath,
    args: [proxyScriptPath(context.runDir), agentSocketPath(context.runId)],
  };
}

/** Whether something accepts connections on `port` of the loopback interface. */
function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** The ports of the range something listens on. */
async function portsInUse(): Promise<number[]> {
  const ports: number[] = [];
  for (let port = serverPorts.first; port <= serverPorts.last; port += 1)
    if (await isListening(port)) ports.push(port);
  return ports;
}

/**
 * The range a page scans must be free: a tab pairs by itself only when
 * exactly one Ayme MCP server listens there, so another coding agent's `ayme
 * mcp` would keep the page from pairing with the run's server, or, in an arm
 * without a server, would pair with the page and could drive it. One object,
 * so a suite checks it once however many arms share it.
 */
export const aymeMcpPortsPrecondition: Precondition = {
  name: "Ayme MCP ports",
  check: async () => {
    const ports = await portsInUse();
    if (ports.length === 0) return null;
    return `Something listens on port ${ports.join(", ")}, in the range ${serverPorts.first} to ${serverPorts.last} a page scans for Ayme MCP servers; the page would pair with it instead of this run's server alone. Stop it (another coding agent's ayme mcp, for example) and run again.`;
  },
};

/** The server command must be built, and the range a page scans must be free. */
export const aymeMcpPreconditions: Precondition[] = [
  {
    name: "Ayme MCP server",
    check: () =>
      existsSync(aymeMcpCliPath)
        ? null
        : `${aymeMcpPackageName} is not built: ${aymeMcpCliPath} is missing. Run pnpm build at the repository root.`,
  },
  aymeMcpPortsPrecondition,
];

/** The arms with the page's tools through WebMCP run no server; the range must still be free. */
export const aymeWebMcpPreconditions: Precondition[] = [
  aymeMcpPortsPrecondition,
];

/** With the Goal Loop on, the lab app's Decision Endpoint must also have its model key. */
export const aymeGoalLoopPreconditions: Precondition[] = [
  ...aymeMcpPreconditions,
  decisionEndpointPrecondition(labUrl),
];

/** What the setup established before the measured window, recorded in the result. */
export type AymeEvidence = {
  server: { name: string; version: string; port: number };
  page: { url: string };
  /** The page paired with the server before the agent started. */
  paired: boolean;
  pairedAt: string;
  /** From opening the start page to the pairing. */
  pairingMs: number;
  /** The page's tool names as WebMCP publishes them: the agent's, without the server prefix, but `screenshot`. */
  tools: string[];
  goalToolPublished: boolean;
  /** Whether the page's page objects were on; off, it published no Page Object Tool. */
  pageObjects: boolean;
  /**
   * Present when the proxy offered the agent the Page Object Tools alone:
   * the tools of the start screen the agent was offered after filtering.
   * The agent's tool list is the proxy's; the server itself lists every tool.
   */
  proxy?: { pageObjectToolsOnly: true; offeredTools: string[] };
};

/** What `setUpAymePage` needs to know about the arm. */
export type AymePageOptions = {
  goalLoop: boolean;
  pageObjects: boolean;
  /** Extra arguments for the headless browser the page opens in. */
  browserArgs?: string[];
  /** Whether the proxy offers the agent the page's Page Object Tools alone. */
  pageObjectToolsOnly?: boolean;
};

type Page = ReturnType<BrowserContext["pages"]>[number];

/** The page's current tool names as WebMCP publishes them: the list it reports to the server, but `screenshot`. */
function publishedToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const modelContext = (
      document as unknown as {
        modelContext?: { getTools(): Promise<{ name: string }[]> };
      }
    ).modelContext;
    if (!modelContext) return [];
    return (await modelContext.getTools()).map((tool) => tool.name).sort();
  });
}

/**
 * What is wrong with a start page without page objects, looked at again after pairing: it must
 * still publish its screen tool (and goal exactly when the Goal Loop is on) and no Page Object
 * Tool, keep this run's pairing, and stay at the start URL. Null when nothing is.
 */
export function settledStartPageProblem(look: {
  tools: string[];
  screenTool: string;
  goalLoop: boolean;
  pairedAddress: string;
  storedAddress: string | null;
  pageUrl: string;
  startUrl: string;
}): string | null {
  const pageObjectTools = pageObjectToolNames(look.tools);
  if (pageObjectTools.length > 0)
    return `The page publishes ${pageObjectTools.join(", ")} although its page objects should be off.`;
  if (
    !look.tools.includes(look.screenTool) ||
    look.tools.includes("goal") !== look.goalLoop
  )
    return `The page publishes ${look.tools.join(", ") || "nothing"} two seconds after pairing, instead of ${look.screenTool} ${look.goalLoop ? "and" : "without"} goal.`;
  if (look.storedAddress !== look.pairedAddress)
    return `The page no longer keeps its pairing with ${look.pairedAddress} two seconds after pairing.`;
  const at = new URL(look.pageUrl);
  const start = new URL(look.startUrl);
  if (
    at.origin !== start.origin ||
    at.pathname !== start.pathname ||
    at.search !== start.search
  )
    return `The paired page is at ${look.pageUrl} instead of the start page ${look.startUrl}.`;
  return null;
}

/** The pairing the tab keeps, once the server has welcomed it with its token. */
function storedPairing(
  page: Page
): Promise<{ address: string; token: string } | null> {
  return page.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    if (stored === null) return null;
    const { address, token } = JSON.parse(stored) as {
      address?: string;
      token?: string;
    };
    return typeof address === "string" && typeof token === "string" && token
      ? { address, token }
      : null;
  }, pairingStorageKey);
}

async function waitFor<T>(
  what: string,
  timeoutMs: number,
  read: () => Promise<T | null>,
  describeLast: (last: T | null) => string = () => ""
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    last = await read();
    if (last !== null) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${what} did not happen within ${timeoutMs / 1000} s.${describeLast(last)}`
  );
}

/**
 * The `ayme mcp` server as the harness runs it: started on `port`, its
 * stderr kept in the run folder, and its stdio handed to the first client of
 * the socket. Whatever the server writes before that client connects is
 * dropped: a server that paired before any agent existed announces the
 * tool-list change to nobody, and the agent's first tool list reflects it.
 */
class HarnessedServer {
  readonly process: ChildProcess;
  readonly log: string[] = [];
  private agent: net.Socket | undefined;
  private listener: net.Server | undefined;
  private pendingOutput = "";
  private readonly context: Pick<ArmContext, "log">;

  constructor(port: number, context: Pick<ArmContext, "log">) {
    this.context = context;
    this.process = spawn(
      process.execPath,
      [aymeMcpCliPath, "mcp", "--port", String(port)],
      {
        // Scrubbed, so the server carries none of the launcher's Claude Code variables or token.
        env: withoutClaudeVariables(process.env),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    this.process.stderr!.on("data", (chunk: Buffer) => {
      for (const line of String(chunk).split("\n"))
        if (line.trim()) this.log.push(`${new Date().toISOString()} ${line}`);
    });
    this.process.stdout!.on("data", (chunk: Buffer) => {
      if (this.agent) {
        this.agent.write(chunk);
        return;
      }
      this.pendingOutput += String(chunk);
      const lastNewline = this.pendingOutput.lastIndexOf("\n");
      if (lastNewline === -1) return;
      const dropped = this.pendingOutput.slice(0, lastNewline).split("\n");
      this.pendingOutput = this.pendingOutput.slice(lastNewline + 1);
      this.context.log(
        `Dropped ${dropped.length} message(s) the Ayme MCP server sent before the agent connected.`
      );
    });
  }

  /** Resolves once the server accepts pages on `port`; rejects when it exits first. */
  waitUntilListening(port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const onExit = (code: number | null) =>
        reject(
          new Error(
            `The Ayme MCP server exited with ${code} before it listened. Its log:\n${this.log.join("\n")}`
          )
        );
      this.process.once("exit", onExit);
      const poll = async () => {
        if (this.process.exitCode !== null) return;
        if (await isListening(port)) {
          this.process.off("exit", onExit);
          resolve();
        } else if (Date.now() > deadline) {
          this.process.off("exit", onExit);
          reject(
            new Error(
              `The Ayme MCP server did not listen on port ${port} within ${timeoutMs / 1000} s. Its log:\n${this.log.join("\n")}`
            )
          );
        } else setTimeout(() => void poll(), 100);
      };
      void poll();
    });
  }

  /** Accepts the agent's proxy on `socketPath`; one client, the first. */
  async listen(socketPath: string): Promise<void> {
    await rm(socketPath, { force: true });
    const listener = net.createServer((client) => {
      if (this.agent) {
        this.context.log(
          "Refused a second client of the Ayme MCP server's socket."
        );
        client.destroy();
        return;
      }
      this.agent = client;
      this.context.log("The agent connected to the Ayme MCP server.");
      if (this.pendingOutput) client.write(this.pendingOutput);
      this.pendingOutput = "";
      client.on("data", (chunk: Buffer) => this.process.stdin!.write(chunk));
      // The agent is gone for good; the server stops with its stdin, as it does under an agent.
      client.on("close", () => this.process.stdin!.end());
      client.on("error", () => {});
    });
    this.listener = listener;
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(socketPath, () => {
        listener.off("error", reject);
        resolve();
      });
    });
  }

  async stop(socketPath: string): Promise<void> {
    this.listener?.close();
    this.agent?.destroy();
    await rm(socketPath, { force: true });
    if (this.process.exitCode === null && !this.process.killed) {
      const exited = new Promise<void>((resolve) =>
        this.process.once("exit", () => resolve())
      );
      this.process.kill("SIGTERM");
      const forceKill = setTimeout(() => this.process.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(forceKill);
    }
  }
}

/**
 * The Ayme arms' setup: the shipped skill in the run's configuration folder,
 * then the server and the page from `setUpAymePage`, with Claude Code's
 * per-call limit raised for `goal`.
 */
export async function setUpAymeAgent(
  context: ArmContext,
  options: { goalLoop: boolean; pageObjects: boolean }
): Promise<ArmSetup> {
  // The shipped skill with its references, read from the fresh configuration folder, as the
  // Playwright CLI arm's skill is.
  const skillDir = aymeSkillDirectory(context.configDir);
  await cp(aymeSkillSource, skillDir, { recursive: true });
  const { evidence, dispose } = await setUpAymePage(context, options);
  return {
    // Claude Code's own per-call limit must outlast a goal call.
    environment: { MCP_TOOL_TIMEOUT: String(mcpToolTimeoutMs) },
    readableDirectories: [skillDir],
    evidence,
    dispose,
  };
}

/**
 * Launches the headless system Chrome on the run's profile, with the arm's
 * browser arguments and the lab app's switches set as cookies before the
 * page loads, and opens the mission's start page.
 */
async function launchStartPage(
  context: Pick<ArmContext, "profileDir" | "start">,
  options: Pick<AymePageOptions, "goalLoop" | "pageObjects" | "browserArgs">
): Promise<{ browser: BrowserContext; page: Page; opened: number }> {
  const origin = new URL(context.start.url).origin;
  const browser = await playwright().chromium.launchPersistentContext(
    context.profileDir,
    {
      channel: "chrome",
      headless: true,
      viewport,
      // The lab app publishes through Chrome's own document.modelContext,
      // which the WebMCP flag supplies; it loads no polyfill.
      args: ["--enable-features=WebMCP", ...(options.browserArgs ?? [])],
    }
  );
  if (options.goalLoop)
    await browser.addCookies([{ ...goalLoopCookie, url: origin }]);
  if (!options.pageObjects)
    await browser.addCookies([{ ...pageObjectsOffCookie, url: origin }]);
  const page = browser.pages()[0] ?? (await browser.newPage());
  const opened = Date.now();
  await page.goto(context.start.url);
  return { browser, page, opened };
}

/**
 * Starts the Ayme MCP server, opens the mission's start page with the Goal
 * Loop and page objects switches set for the arm, waits until the page has
 * paired with the server and published the screen's tools, and hands the
 * server to the agent through the proxy in the run folder.
 */
export async function setUpAymePage(
  context: ArmContext,
  options: AymePageOptions
): Promise<Pick<ArmSetup, "dispose"> & { evidence: AymeEvidence }> {
  const pageObjectToolsOnly = options.pageObjectToolsOnly === true;
  const screenTool = options.pageObjects
    ? startScreenTool[context.start.screen]
    : "snapshot";
  const socketPath = agentSocketPath(context.runId);
  const logPath = path.join(context.runDir, "ayme-mcp.log");

  // Re-checked here: the precondition ran before the seed, and only one server may be in the range.
  const inUse = await portsInUse();
  if (inUse.length > 0)
    throw new Error(
      `Something listens on port ${inUse.join(", ")}, in the range a page scans for Ayme MCP servers. Stop it and run again.`
    );
  const port = serverPorts.first;
  const server = new HarnessedServer(port, context);
  const writeLog = () =>
    writeFile(logPath, `${server.log.join("\n")}\n`).catch(() => {});

  let browser: BrowserContext | null = null;
  const dispose = async () => {
    for (const close of [
      () => browser?.close(),
      () => server.stop(socketPath),
    ]) {
      try {
        await close();
      } catch (error) {
        context.log(
          `Closing the Ayme setup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    await writeLog();
  };

  try {
    await server.waitUntilListening(port, 15_000);
    context.log(`Ayme MCP server listening on port ${port}.`);
    await mkdir(context.runDir, { recursive: true });
    await writeFile(
      proxyScriptPath(context.runDir),
      proxyScript({ pageObjectToolsOnly })
    );
    await server.listen(socketPath);

    const launched = await launchStartPage(context, options);
    browser = launched.browser;
    const { page, opened } = launched;
    // The page scans the range as it loads and finds this run's server alone.
    const pairing = await waitFor(
      "Pairing the start page with the Ayme MCP server",
      90_000,
      () => storedPairing(page),
      () =>
        ` The lab app must run in lab mode (pnpm lab:dev) for the page to look for a server. Server log:\n${server.log.join("\n")}`
    );
    const pairedAt = new Date();
    if (pairing.address !== `ws://127.0.0.1:${port}`)
      throw new Error(
        `The page paired with ${pairing.address} instead of this run's server on port ${port}.`
      );
    if (!server.log.some((line) => line.includes("A page connected.")))
      throw new Error(
        `The page stored a pairing but the server did not report it. Server log:\n${server.log.join("\n")}`
      );
    let tools = await waitFor(
      `Publishing ${options.goalLoop ? `${screenTool} and goal` : screenTool}`,
      60_000,
      async () => {
        const names = await publishedToolNames(page);
        const complete =
          names.includes(screenTool) &&
          (!options.goalLoop || names.includes("goal"));
        return complete ? names : null;
      },
      (last) => ` The page published ${last?.join(", ") || "nothing"}.`
    );
    const goalToolPublished = tools.includes("goal");
    if (goalToolPublished !== options.goalLoop)
      throw new Error(
        `The page publishes goal although the Goal Loop should be off for ${context.runId}.`
      );
    if (!options.pageObjects) {
      // The provider publishes a screen's Page Object Tools as it mounts them, so look again once
      // they would have had time to appear. That second look is the one recorded, so it must still
      // show a complete, paired start page.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      tools = await publishedToolNames(page);
      const problem = settledStartPageProblem({
        tools,
        screenTool,
        goalLoop: options.goalLoop,
        pairedAddress: pairing.address,
        storedAddress: (await storedPairing(page))?.address ?? null,
        pageUrl: page.url(),
        startUrl: context.start.url,
      });
      if (problem) throw new Error(`${problem} (${context.runId})`);
    }
    context.log(
      `The start page paired with the Ayme MCP server ${pairedAt.getTime() - opened} ms after opening, with ${tools.length} tools; goal ${goalToolPublished ? "is" : "is not"} published; page objects are ${options.pageObjects ? "on" : "off"}.`
    );
    if (pageObjectToolsOnly)
      context.log(
        `The proxy offers the agent the Page Object Tools alone: ${pageObjectToolNames(tools).join(", ")}.`
      );
    await writeLog();
    const evidence: AymeEvidence = {
      server: { name: aymeMcpPackageName, version: aymeMcpVersion(), port },
      page: { url: page.url() },
      paired: true,
      pairedAt: pairedAt.toISOString(),
      pairingMs: pairedAt.getTime() - opened,
      tools,
      goalToolPublished,
      pageObjects: options.pageObjects,
      ...(pageObjectToolsOnly
        ? {
            proxy: {
              pageObjectToolsOnly,
              offeredTools: pageObjectToolNames(tools),
            },
          }
        : {}),
    };
    return { evidence, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/**
 * What the setup of an arm with the page's tools through WebMCP established,
 * recorded in the result. No Ayme MCP server ran and nothing paired: the
 * page's tools reach the agent through Playwright's WebMCP collection alone.
 */
export type WebMcpEvidence = {
  server: null;
  page: { url: string };
  paired: false;
  /** From opening the start page to the start screen's Page Object Tool being published. */
  publishedMs: number;
  /** The page's tool names as WebMCP publishes them, read from `document.modelContext`. */
  tools: string[];
  goalToolPublished: false;
  pageObjects: true;
  /** The flag the browser was launched with, and the Page Object Tools among the start screen's tools. */
  webmcp: { browserFlag: string; pageObjectTools: string[] };
};

/**
 * Opens the mission's start page as `setUpAymePage` does, with the page
 * objects on and the Goal Loop off, on a Chrome with the WebMCP flag beside
 * the arm's own browser arguments, and waits until the page publishes the
 * start screen's Page Object Tool. No Ayme MCP server is started: the agent
 * reaches the page's tools through Playwright, which collects them from
 * `document.modelContext` itself. The range a page scans is re-checked, so
 * no stray server pairs with the page.
 */
export async function setUpWebMcpPage(
  context: ArmContext,
  options: { browserArgs: string[] }
): Promise<Pick<ArmSetup, "dispose"> & { evidence: WebMcpEvidence }> {
  const screenTool = startScreenTool[context.start.screen];
  const inUse = await portsInUse();
  if (inUse.length > 0)
    throw new Error(
      `Something listens on port ${inUse.join(", ")}, in the range a page scans for Ayme MCP servers; it would pair with the page. Stop it and run again.`
    );
  const { browser, page, opened } = await launchStartPage(context, {
    goalLoop: false,
    pageObjects: true,
    browserArgs: [...options.browserArgs, webMcpFeatureFlag],
  });
  const dispose = async () => {
    try {
      await browser.close();
    } catch (error) {
      context.log(
        `Closing the WebMCP page's browser failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  try {
    const tools = await waitFor(
      `Publishing ${screenTool} through WebMCP`,
      60_000,
      async () => {
        const names = await publishedToolNames(page);
        return names.includes(screenTool) ? names : null;
      },
      (last) =>
        ` The page published ${last?.join(", ") || "nothing"}. The lab app must run (pnpm lab:dev), and the browser must supply document.modelContext: Chrome with ${webMcpFeatureFlag}, or the app's polyfill.`
    );
    const publishedMs = Date.now() - opened;
    if (tools.includes("goal"))
      throw new Error(
        `The page publishes goal although the Goal Loop should be off for ${context.runId}.`
      );
    const pageObjectTools = pageObjectToolNames(tools);
    context.log(
      `The start page published ${tools.length} tools through WebMCP ${publishedMs} ms after opening, the Page Object Tools ${pageObjectTools.join(", ")} among them; no Ayme MCP server runs.`
    );
    const evidence: WebMcpEvidence = {
      server: null,
      page: { url: page.url() },
      paired: false,
      publishedMs,
      tools,
      goalToolPublished: false,
      pageObjects: true,
      webmcp: { browserFlag: webMcpFeatureFlag, pageObjectTools },
    };
    return { evidence, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
