/**
 * Everything the Ayme arms set up before the measured window: the Ayme MCP
 * server the agent talks to, `ayme mcp` from `@ayme-dev/mcp`, paired with a
 * headless browser holding the signed-in survey editor, with the Goal Loop
 * switch set for the arm.
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
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { ArmContext, ArmSetup, McpServer } from "./arms.ts";
import { playwright, viewport, type BrowserContext } from "./browser.ts";
import { withoutClaudeVariables } from "./claude.ts";
import type { Precondition } from "./preconditions.ts";

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

/**
 * The lab app's Goal Loop switch: with this cookie set before the page loads,
 * the page publishes `goal`. Without it the Goal Loop is off.
 */
export const goalLoopCookie = { name: "ayme-lab-goal-loop", value: "on" };

/**
 * How long Claude Code lets one MCP tool call run. The `goal` tool runs the
 * whole Goal Loop inside one call, far beyond any default per-call limit; the
 * server itself waits for the page's answer however long it takes.
 */
export const mcpToolTimeoutMs = 320_000;

/** The ports a page's auto-pair scan probes; the server listens on one of them. */
export const serverPorts = { first: 9350, last: 9365 };

/** The Page Object Tool the editor publishes: proof that the paired page is the editor with Ayme's tools. */
const editorTool = "SurveyEditorPage.setSurveyName";

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
 * The command Claude Code starts as the agent's MCP server: forwards its
 * stdio to the `ayme mcp` the harness started and paired before the agent,
 * through the socket named on its command line.
 */
export function proxyScript() {
  return `// Written by the eval harness for one run. Claude Code starts this as the agent's MCP server command;
// it forwards the agent's stdio to the ayme mcp server the harness started and paired before the agent.
const net = require("node:net");
const socket = net.connect(process.argv[2]);
socket.on("connect", () => {
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
 * The server command must be built, and the range a page scans must be free:
 * a tab pairs by itself only when exactly one Ayme MCP server listens there,
 * so another coding agent's `ayme mcp` would keep the page from pairing.
 */
export const aymeMcpPreconditions: Precondition[] = [
  {
    name: "Ayme MCP server",
    check: () =>
      existsSync(aymeMcpCliPath)
        ? null
        : `${aymeMcpPackageName} is not built: ${aymeMcpCliPath} is missing. Run pnpm build at the repository root.`,
  },
  {
    name: "Ayme MCP ports",
    check: async () => {
      const ports = await portsInUse();
      if (ports.length === 0) return null;
      return `Something listens on port ${ports.join(", ")}, in the range ${serverPorts.first} to ${serverPorts.last} a page scans for Ayme MCP servers; the page would not pair with this run's server alone. Stop it (another coding agent's ayme mcp, for example) and run again.`;
    },
  },
];

/** What the setup established before the measured window, recorded in the result. */
export type AymeEvidence = {
  server: { name: string; version: string; port: number };
  page: { url: string };
  /** The page paired with the server before the agent started. */
  paired: boolean;
  pairedAt: string;
  /** From opening the editor to the pairing. */
  pairingMs: number;
  /** The page's tool names, as the agent sees them without the server prefix. */
  tools: string[];
  goalToolPublished: boolean;
};

type Page = ReturnType<BrowserContext["pages"]>[number];

/** The page's current tool names; what it publishes through WebMCP is the list it reports to the server. */
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
 * Starts the Ayme MCP server, opens the signed-in editor with the Goal Loop
 * switch set for the arm, waits until the page has paired with the server
 * and published the editor's tools, and hands the server to the agent.
 */
export async function setUpAymeAgent(
  context: ArmContext,
  options: { goalLoop: boolean }
): Promise<ArmSetup> {
  const origin = new URL(context.startUrl).origin;
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
    await writeFile(proxyScriptPath(context.runDir), proxyScript());
    await server.listen(socketPath);

    browser = await playwright().chromium.launchPersistentContext(
      context.profileDir,
      { channel: "chrome", headless: true, viewport }
    );
    if (options.goalLoop)
      await browser.addCookies([{ ...goalLoopCookie, url: origin }]);
    const page = browser.pages()[0] ?? (await browser.newPage());
    const opened = Date.now();
    await page.goto(context.startUrl);
    // The page scans the range as it loads and finds this run's server alone.
    const pairing = await waitFor(
      "Pairing the editor with the Ayme MCP server",
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
    const tools = await waitFor(
      `Publishing ${options.goalLoop ? `${editorTool} and goal` : editorTool}`,
      60_000,
      async () => {
        const names = await publishedToolNames(page);
        const complete =
          names.includes(editorTool) &&
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
    context.log(
      `The editor paired with the Ayme MCP server ${pairedAt.getTime() - opened} ms after opening, with ${tools.length} tools; goal ${goalToolPublished ? "is" : "is not"} published.`
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
    };
    return {
      // Claude Code's own per-call limit must outlast a goal call.
      environment: { MCP_TOOL_TIMEOUT: String(mcpToolTimeoutMs) },
      readableDirectories: [],
      evidence,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
