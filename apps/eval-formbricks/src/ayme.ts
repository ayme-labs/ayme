/**
 * Everything the arms with Ayme set up before the measured window. The lab
 * app is unmodified Formbricks and ships no Ayme: an `ayme mcp` from
 * `@ayme-dev/mcp`, started in the lab app's folder, builds and serves the
 * Page Objects in its `.ayme/` and writes `.ayme/init-script.js`, and the
 * headless browser the harness launches on the mission's start page runs
 * that init script in every document, so the page starts Ayme and pairs
 * with the server by itself.
 *
 * The server is started with the command the `ayme` skill's reference on
 * browser automation tools gives for the arm's channel (`aymeStartArgs`),
 * plus `--port`, so every start writes the same init script:
 *
 * - `mcp`: the agent gets the server as its `ayme` MCP server, which lists
 *   the screen's Page Object Tools, `page_objects` and its own tools.
 * - `webmcp`: the server runs with `--webmcp`, so the page also publishes the
 *   Page Object Tools and `page_objects` through `document.modelContext`,
 *   where the agent's browser automation reads them. No agent is given the
 *   server.
 *
 * A coding agent normally starts its own `ayme mcp` over stdio, and a tab of
 * the app on localhost pairs with it by itself. Claude Code starts its MCP
 * servers only when the agent starts and reads their tool lists at once, so
 * a tab that pairs then would reach the agent through a tool-list change
 * somewhere around its first turn. So the harness starts the server itself,
 * lets the page pair with it, and hands the server's stdio to Claude Code
 * through a small proxy over a Unix socket. The proxy forwards bytes and
 * changes nothing: what the agent is offered is the server's own doing.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { ArmContext, McpServer } from "./arms.ts";
import { playwright, viewport, type BrowserContext } from "./browser.ts";
import { withoutClaudeVariables } from "./claude.ts";
import type { StartScreen } from "./missions.ts";
import { labRoot, repoRoot } from "./paths.ts";
import type { Precondition } from "./preconditions.ts";

export const aymeMcpPackageName = "@ayme-dev/mcp";
const aymeMcpPackagePath = createRequire(import.meta.url).resolve(
  `${aymeMcpPackageName}/package.json`
);
const aymeMcpRoot = path.dirname(aymeMcpPackagePath);
/** The `ayme` command's file, as its `bin` names it; built by `pnpm lab:prepare`. */
export const aymeMcpCliPath = path.join(aymeMcpRoot, "dist/cli.mjs");

export function aymeMcpVersion(): string {
  const manifest = JSON.parse(readFileSync(aymeMcpPackagePath, "utf8")) as {
    version: string;
  };
  return manifest.version;
}

/** The MCP server's name in the agent's configuration; its tools are `mcp__ayme__<tool>`. */
export const aymeServerName = "ayme";

/** The skill the arms with Ayme load: the one this repository ships to consumers, so the eval measures that. */
export const aymeSkillName = "ayme";
export const aymeSkillSource = path.join(repoRoot, "skills", aymeSkillName);

/**
 * The skill's reference the setup turn of every arm with Ayme reads: what to
 * start, and what to read after a Page Object Tool, per browser automation.
 * The interface line carries none of it.
 */
export const aymeReference = "references/browser-automation-tools.md";

/** Where Claude Code loads user skills from, inside the run's configuration folder. */
export function aymeSkillDirectory(configDir: string) {
  return path.join(configDir, "skills", aymeSkillName);
}

/** Copies the shipped skill, references included, into the run's configuration folder; returns its folder. */
export async function installAymeSkill(configDir: string): Promise<string> {
  const skillDir = aymeSkillDirectory(configDir);
  await cp(aymeSkillSource, skillDir, { recursive: true });
  return skillDir;
}

/**
 * How the Page Object Tools reach the agent: through Ayme's own MCP server
 * (`mcp`), or through the page's WebMCP publication, which the agent's
 * browser automation reads (`webmcp`).
 */
export type AymeChannel = "mcp" | "webmcp";

/**
 * The `ayme` command the reference gives for a channel, after
 * `npx -y @ayme-dev/mcp@<version>`.
 */
export function aymeStartArgs(channel: AymeChannel): string[] {
  return channel === "webmcp" ? ["mcp", "--webmcp"] : ["mcp"];
}

/** The ports a page's auto-pair scan probes; the server listens on the first. */
export const serverPorts = { first: 9350, last: 9365 };

/** The command as the harness runs it: the reference's, on the range's first port. */
export function aymeMcpArgs(channel: AymeChannel, port: number): string[] {
  return [...aymeStartArgs(channel), "--port", String(port)];
}

/** The init script `ayme mcp` writes as it starts in the lab app's folder, naming its port. Git ignores it. */
export const initScriptPath = path.join(labRoot, ".ayme/init-script.js");

/**
 * What a page that loads the init script needs of its browser context:
 * Formbricks's content security policy allows neither the served modules nor
 * the server's loopback WebSocket, and Chrome asks before a page reaches
 * `127.0.0.1`.
 */
export const servedPageContextOptions = {
  bypassCSP: true,
  permissions: ["local-network-access"],
};

/**
 * The arguments every browser the harness launches gets: the arm's own, then
 * one `--enable-features` switch with WebMCP, which supplies
 * `document.modelContext`, and the arm's extra Chrome features. Chrome reads
 * one such switch, so the features travel together.
 */
export function browserLaunchArgs(
  browserArgs: string[] = [],
  browserFeatures: string[] = []
): string[] {
  return [
    ...browserArgs,
    `--enable-features=${["WebMCP", ...browserFeatures].join(",")}`,
  ];
}

/**
 * A Page Object Tool each start screen offers: proof that the paired page
 * is that screen with the lab app's Page Objects.
 */
export const startScreenTool: Record<StartScreen, string> = {
  editor: "SurveyEditorPage.fillSurveyForm",
  "sign-in": "SignInPage.logIn",
};

/** The read tool every channel offers beside the screen's Page Object Tools. */
export const pageObjectsToolName = "page_objects";

/** The server's own tools, which `ayme mcp` lists in every mode. */
export const serverOwnTools = [
  "ayme_connect",
  "ayme_inspect",
  "ayme_list_tools",
  "ayme_call",
];

/**
 * A Page Object Tool's name: `<class>.<action>`, both identifiers. A Peek
 * Tool, the one other dotted family, is `peek.<name>`.
 */
export function isPageObjectToolName(name: string): boolean {
  return /^(?!peek\.)[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(name);
}

/**
 * The names among `listed` the channel must not offer: on WebMCP anything but
 * Page Object Tools and `page_objects`; through `ayme mcp` also anything but
 * its own tools. Ayme's `snapshot`, `goal` and Browser Tools land here.
 */
export function unexpectedToolNames(
  listed: string[],
  channel: AymeChannel
): string[] {
  return listed.filter(
    (name) =>
      !isPageObjectToolName(name) &&
      name !== pageObjectsToolName &&
      !(channel === "mcp" && serverOwnTools.includes(name))
  );
}

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

/** Resolves a package as the served build does: from the lab app's folder. */
const requireFromLab = createRequire(path.join(labRoot, "package.json"));

function resolvesFromLab(specifier: string): boolean {
  try {
    requireFromLab.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * The server command must be built, and so must the `@ayme-dev/ayme` it
 * builds the lab app's Page Objects with; with `--webmcp`, also the
 * `@ayme-dev/webmcp` the served runtime publishes with. The range a page
 * scans must be free: a tab pairs by itself only when exactly one Ayme MCP
 * server listens there. Shared objects, so a suite checks each once.
 */
const aymeMcpBuilt: Precondition = {
  name: "Ayme MCP server",
  check: () => {
    if (!existsSync(aymeMcpCliPath))
      return `${aymeMcpPackageName} is not built: ${aymeMcpCliPath} is missing. Run pnpm lab:prepare in apps/lab-formbricks.`;
    if (!resolvesFromLab("@ayme-dev/ayme/compiler"))
      return "@ayme-dev/ayme, which the server builds and serves the lab app's Page Objects with, is not built. Run pnpm lab:prepare in apps/lab-formbricks.";
    return null;
  },
};

const aymeWebMcpBuilt: Precondition = {
  name: "Ayme WebMCP package",
  check: () =>
    resolvesFromLab("@ayme-dev/webmcp")
      ? null
      : "@ayme-dev/webmcp, which the served runtime publishes through WebMCP with, is not built. Run pnpm lab:prepare in apps/lab-formbricks.",
};

const aymeMcpPorts: Precondition = {
  name: "Ayme MCP ports",
  check: async () => {
    const ports = await portsInUse();
    if (ports.length === 0) return null;
    return `Something listens on port ${ports.join(", ")}, in the range ${serverPorts.first} to ${serverPorts.last} a page scans for Ayme MCP servers; the page would not pair with this run's server alone. Stop it (another coding agent's ayme mcp, for example) and run again.`;
  },
};

export const aymePreconditions: Record<AymeChannel, Precondition[]> = {
  mcp: [aymeMcpBuilt, aymeMcpPorts],
  webmcp: [aymeMcpBuilt, aymeWebMcpBuilt, aymeMcpPorts],
};

/** What the setup established before the measured window, recorded in the result. */
export type AymeEvidence = {
  server: { name: string; version: string; port: number; args: string[] };
  channel: AymeChannel;
  page: { url: string };
  /** The page paired with the server before the agent started. */
  paired: true;
  pairedAt: string;
  /** From opening the start page to the pairing. */
  pairingMs: number;
  /** The tool names the channel offers on the start screen: what `ayme mcp` lists, or what the page publishes through WebMCP. */
  tools: string[];
};

export type Page = ReturnType<BrowserContext["pages"]>[number];

/** The page's tool names as WebMCP publishes them, read from `document.modelContext`. */
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
 * What is wrong with the init script the run's server wrote: it must name
 * the run's port and turn WebMCP publication on exactly for the `webmcp`
 * channel. Null when nothing is.
 */
export function initScriptProblem(
  script: string,
  expected: { port: number; channel: AymeChannel }
): string | null {
  if (!script.includes(`http://127.0.0.1:${expected.port}/`))
    return `The init script at ${initScriptPath} does not name this run's server on port ${expected.port}.`;
  const webmcp = /webMCP:\s*\{\s*enabled:\s*true\s*\}/.test(script);
  if (webmcp !== (expected.channel === "webmcp"))
    return `The init script at ${initScriptPath} turns WebMCP publication ${webmcp ? "on" : "off"}, and this arm needs it ${webmcp ? "off" : "on"}.`;
  return null;
}

/**
 * The `ayme mcp` server as the harness runs it: started in the lab app's
 * folder, its stderr kept in the run folder. It leads a process group of its
 * own, so stopping it stops the esbuild service it starts too, which
 * inherits its standard error. Until an agent connects to its socket, the
 * harness itself may ask it for its tool list; then its stdio is handed to
 * the first client of the socket. What else it writes before that client
 * connects is dropped: a server that paired before any agent existed
 * announces the tool-list change to nobody, and the agent's first tool list
 * reflects it.
 */
class HarnessedServer {
  readonly process: ChildProcess;
  readonly log: string[] = [];
  private agent: net.Socket | undefined;
  private listener: net.Server | undefined;
  private pendingOutput = "";
  private readonly context: Pick<ArmContext, "log">;
  private readonly requests = new Map<
    string,
    (message: { result?: unknown; error?: unknown }) => void
  >();
  private requestCount = 0;

  constructor(args: string[], context: Pick<ArmContext, "log">) {
    this.context = context;
    this.process = spawn(process.execPath, [aymeMcpCliPath, ...args], {
      // Where the server finds the Page Objects it serves and writes its init script.
      cwd: labRoot,
      // Scrubbed, so the server carries none of the launcher's Claude Code variables or token.
      env: withoutClaudeVariables(process.env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
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
      const lines = this.pendingOutput.slice(0, lastNewline).split("\n");
      this.pendingOutput = this.pendingOutput.slice(lastNewline + 1);
      for (const line of lines) this.answered(line);
    });
  }

  /** Settles one of the harness's own requests when `line` answers it. */
  private answered(line: string) {
    let message: { id?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    const settle =
      typeof message.id === "string" ? this.requests.get(message.id) : null;
    if (!settle) return;
    this.requests.delete(message.id as string);
    settle(message);
  }

  /**
   * The names of the tools the server lists now, as an agent's `tools/list`
   * reads them. Only before the agent connects. The harness sends no
   * `initialize`, which the server does not require, so the agent's own
   * stays the session's one.
   */
  listToolNames(timeoutMs = 10_000): Promise<string[]> {
    if (this.agent)
      throw new Error(
        "The Ayme MCP server's stdio is the agent's once it has connected."
      );
    const id = `eval-harness-${(this.requestCount += 1)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(
          new Error(
            `The Ayme MCP server did not answer tools/list within ${timeoutMs / 1000} s. Its log:\n${this.log.join("\n")}`
          )
        );
      }, timeoutMs);
      this.requests.set(id, ({ result, error }) => {
        clearTimeout(timer);
        const tools = (result as { tools?: { name: string }[] } | undefined)
          ?.tools;
        if (Array.isArray(tools))
          resolve(tools.map((tool) => tool.name).sort());
        else
          reject(
            new Error(
              `The Ayme MCP server answered tools/list with ${JSON.stringify(error ?? result)}.`
            )
          );
      });
      this.process.stdin!.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" })}\n`
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

  private signalGroup(signal: NodeJS.Signals) {
    try {
      process.kill(-this.process.pid!, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  /** Closes the socket and stops the server's process group, a server that ended by itself included. */
  async stop(socketPath: string): Promise<void> {
    this.listener?.close();
    this.agent?.destroy();
    await rm(socketPath, { force: true });
    const exited =
      this.process.exitCode !== null || this.process.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) =>
            this.process.once("exit", () => resolve())
          );
    this.signalGroup("SIGTERM");
    const forceKill = setTimeout(() => this.signalGroup("SIGKILL"), 5_000);
    await exited;
    clearTimeout(forceKill);
    // The esbuild service may outlive the server by a moment; it belongs to the same group.
    this.signalGroup("SIGKILL");
    this.process.stdout?.destroy();
    this.process.stderr?.destroy();
  }
}

/**
 * Launches the headless system Chrome on the run's profile, with the arm's
 * browser arguments and the WebMCP flag, and opens the mission's start page.
 * With `initScript`, every document of the browser's pages runs it first, in
 * a context that lets it reach the server: the page the harness opens here,
 * and whatever the agent's own browser automation, attached over CDP,
 * navigates it to or opens beside it, since the harness stays attached for
 * the run. Without it the page is Formbricks as it is, with nothing of Ayme.
 */
export async function launchStartPage(
  context: Pick<ArmContext, "profileDir" | "start">,
  options: {
    browserArgs?: string[];
    browserFeatures?: string[];
    initScript?: string;
  }
): Promise<{ browser: BrowserContext; page: Page; opened: number }> {
  const browser = await playwright().chromium.launchPersistentContext(
    context.profileDir,
    {
      channel: "chrome",
      headless: true,
      viewport,
      args: browserLaunchArgs(options.browserArgs, options.browserFeatures),
      ...(options.initScript === undefined ? {} : servedPageContextOptions),
    }
  );
  try {
    if (options.initScript !== undefined)
      await browser.addInitScript({ path: options.initScript });
    const page = browser.pages()[0] ?? (await browser.newPage());
    const opened = Date.now();
    await page.goto(context.start.url);
    return { browser, page, opened };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

/** What a setup that serves the Page Objects hands back: the evidence and how to undo it. */
export type AymeSetup = {
  evidence: AymeEvidence;
  dispose: () => Promise<void>;
};

/**
 * Starts the run's `ayme mcp` in the lab app's folder with the channel's
 * command, waits for the init script it writes, launches the browser with
 * that init script on the mission's start page, waits until the page has
 * paired with the server, and then until the channel offers the start
 * screen's Page Object Tool: `ayme mcp`'s tool list for `mcp`, read as the
 * agent will read it, or the page's WebMCP publication for `webmcp`. The
 * channel must offer `page_objects` beside it and nothing of Ayme's own
 * browser driving. For `mcp` the server's stdio becomes the agent's, through
 * the proxy written into the run folder; for `webmcp` no agent is given it.
 * Disposes of what it started when it fails.
 */
export async function setUpAymePage(
  context: ArmContext,
  options: {
    channel: AymeChannel;
    browserArgs?: string[];
    browserFeatures?: string[];
  }
): Promise<AymeSetup> {
  const { channel } = options;
  const screenTool = startScreenTool[context.start.screen];
  const socketPath = agentSocketPath(context.runId);
  const logPath = path.join(context.runDir, "ayme-mcp.log");

  // Re-checked here: the precondition ran before the seed, and only one server may be in the range.
  const inUse = await portsInUse();
  if (inUse.length > 0)
    throw new Error(
      `Something listens on port ${inUse.join(", ")}, in the range a page scans for Ayme MCP servers. Stop it and run again.`
    );
  const port = serverPorts.first;
  const args = aymeMcpArgs(channel, port);
  // An earlier server's init script, which may name another port or another WebMCP setting.
  await rm(initScriptPath, { force: true });
  const server = new HarnessedServer(args, context);
  const writeLog = async () => {
    await mkdir(context.runDir, { recursive: true });
    await writeFile(logPath, `${server.log.join("\n")}\n`).catch(() => {});
  };

  let browser: BrowserContext | null = null;
  const dispose = async () => {
    for (const close of [
      () => browser?.close(),
      () => server.stop(socketPath),
      // The server is gone, so its init script would load nothing.
      () => rm(initScriptPath, { force: true }),
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
    context.log(
      `Ayme MCP server listening on port ${port}: ayme ${args.join(" ")}.`
    );
    // The server says so once the init script is written, after it listens.
    await waitFor(
      "Writing the init script",
      15_000,
      async () =>
        server.log.some((line) => line.includes(initScriptPath)) ? true : null,
      () => ` Server log:\n${server.log.join("\n")}`
    );
    const problem = initScriptProblem(readFileSync(initScriptPath, "utf8"), {
      port,
      channel,
    });
    if (problem) throw new Error(problem);
    if (channel === "mcp") {
      await mkdir(context.runDir, { recursive: true });
      await writeFile(proxyScriptPath(context.runDir), proxyScript());
      await server.listen(socketPath);
    }

    const launched = await launchStartPage(context, {
      browserArgs: options.browserArgs,
      browserFeatures: options.browserFeatures,
      initScript: initScriptPath,
    });
    browser = launched.browser;
    const { page, opened } = launched;
    // The page scans the range as it loads and finds this run's server alone.
    const pairing = await waitFor(
      "Pairing the start page with the Ayme MCP server",
      90_000,
      () => storedPairing(page),
      () =>
        ` The lab app must run (pnpm lab:dev), and the page must load the Page Objects the server serves. Server log:\n${server.log.join("\n")}`
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

    const offered = () =>
      channel === "mcp" ? server.listToolNames() : publishedToolNames(page);
    const tools = await waitFor(
      `Offering ${screenTool} through ${channel === "mcp" ? "ayme mcp" : "WebMCP"}`,
      60_000,
      async () => {
        const names = await offered();
        return names.includes(screenTool) ? names : null;
      },
      (last) =>
        ` It offered ${last?.join(", ") || "nothing"}. Server log:\n${server.log.join("\n")}`
    );
    const unexpected = unexpectedToolNames(tools, channel);
    if (unexpected.length > 0 || !tools.includes(pageObjectsToolName))
      throw new Error(
        `The page's tools through ${channel === "mcp" ? "ayme mcp" : "WebMCP"} are ${tools.join(", ")}: they hold ${unexpected.join(", ") || `no ${pageObjectsToolName}`} (${context.runId}).`
      );
    context.log(
      `The start page paired with the Ayme MCP server ${pairedAt.getTime() - opened} ms after opening; ${channel === "mcp" ? "the server lists" : "the page publishes through WebMCP"} ${tools.join(", ")}.`
    );
    await writeLog();
    return {
      evidence: {
        server: {
          name: aymeMcpPackageName,
          version: aymeMcpVersion(),
          port,
          args,
        },
        channel,
        page: { url: page.url() },
        paired: true,
        pairedAt: pairedAt.toISOString(),
        pairingMs: pairedAt.getTime() - opened,
        tools,
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
