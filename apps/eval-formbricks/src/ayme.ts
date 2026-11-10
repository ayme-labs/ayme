/**
 * Everything the arms with Ayme set up before the measured window. The lab
 * app is unmodified Formbricks and ships no Ayme: an `ayme mcp` from
 * `@ayme-dev/mcp`, started in the lab app's folder, builds and serves the
 * Page Objects in its `.ayme/` and writes `.ayme/init-script.js`, and the
 * headless browser the harness launches on the mission's start page runs
 * that init script in every document, so the page starts Ayme and pairs
 * with the server by itself. The arms differ in what the server is started
 * with and in how the page's tools reach the agent.
 *
 * The Ayme arms, and the arms that add Ayme's Page Object Tools to a browser
 * tool through the `ayme` server (`setUpAymePage`), hand the server to the
 * agent. The pairing follows the tab through the screens the task moves it
 * to: the server tells the agent each time the tools change. The arm
 * without Page Objects has the server serve the lab app's entry that lists
 * none. The arms that add the Page Object Tools to a browser tool add its
 * browser arguments and a proxy that offers the agent the Page Object Tools
 * alone.
 *
 * The arms that reach the page's tools through their browser tool's own
 * WebMCP support (`setUpWebMcpPage`) start the server with `--webmcp`, so
 * the page also publishes through `document.modelContext`, on a Chrome
 * whose WebMCP flag is on. Their server serves the files and nothing else:
 * no agent is given it.
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
import type { ChildProcess } from "node:child_process";
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
import { labRoot, repoRoot } from "./paths.ts";
import type { Precondition } from "./preconditions.ts";
import { spawnProcessGroup } from "./processGroup.ts";

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
 * The entries `ayme mcp` serves from the lab app's folder, relative to it:
 * the lab app's Page Objects, which the server finds by itself, and the
 * entry without any, the lab app's one switch, which `--page-objects` names.
 * Served the second, the page offers `snapshot` and the Browser Tools and no
 * Page Object Tool.
 */
export const pageObjectsEntry = ".ayme/page-objects.ts";
export const noPageObjectsEntry = ".ayme/no-page-objects.ts";

/**
 * The init script `ayme mcp` writes as it starts in the lab app's folder,
 * naming its port. Git ignores it there.
 */
export const initScriptPath = path.join(labRoot, ".ayme/init-script.js");

/** What the run's `ayme mcp` serves and how. */
export type ServedPageObjects = {
  /** With the lab app's Page Objects, or with its entry that lists none. */
  pageObjects: boolean;
  /** Whether the page also publishes its tools through `document.modelContext`. */
  webmcp: boolean;
};

/**
 * The `ayme` command's arguments for a run: the server on `port`, so every
 * start writes the same init script, serving the entry for the arm.
 */
export function aymeMcpArgs(port: number, served: ServedPageObjects): string[] {
  return [
    "mcp",
    "--port",
    String(port),
    ...(served.pageObjects ? [] : ["--page-objects", noPageObjectsEntry]),
    ...(served.webmcp ? ["--webmcp"] : []),
  ];
}

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
 * The Chrome flag that supplies `document.modelContext` natively: the WebMCP
 * API, `registerTool`, `getTools`, `executeTool` and `ontoolchange`, and no
 * `navigator.modelContext`. Without it a Chrome supplies neither, and
 * Playwright MCP and the Playwright CLI supply none either: both read
 * `document.modelContext ?? navigator.modelContext` and collect the tools a
 * page registered there. Every browser the harness launches gets the flag.
 * Only a page served with `--webmcp` publishes there: Formbricks itself
 * registers no tool, and without `--webmcp` the served runtime keeps its
 * WebMCP publication off.
 */
export const webMcpFeatureFlag = "--enable-features=WebMCP";

/**
 * The arguments every browser the harness launches gets: the arm's own, then
 * one `--enable-features` switch with WebMCP and the arm's extra Chrome
 * features. Chrome reads one such switch, so the features travel together.
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
 * mcp` would keep the page from pairing with the run's server, which starts
 * on the range's first port. One object, so a suite checks it once however
 * many arms share it.
 */
export const aymeMcpPortsPrecondition: Precondition = {
  name: "Ayme MCP ports",
  check: async () => {
    const ports = await portsInUse();
    if (ports.length === 0) return null;
    return `Something listens on port ${ports.join(", ")}, in the range ${serverPorts.first} to ${serverPorts.last} a page scans for Ayme MCP servers; the page would pair with it instead of this run's server alone. Stop it (another coding agent's ayme mcp, for example) and run again.`;
  },
};

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
 * builds the lab app's Page Objects with and serves as the page's runtime.
 * One object, as the ports check is.
 */
export const aymeMcpBuiltPrecondition: Precondition = {
  name: "Ayme MCP server",
  check: () => {
    if (!existsSync(aymeMcpCliPath))
      return `${aymeMcpPackageName} is not built: ${aymeMcpCliPath} is missing. Run pnpm lab:prepare in apps/lab-formbricks.`;
    if (!resolvesFromLab("@ayme-dev/ayme/compiler"))
      return "@ayme-dev/ayme, which the server builds and serves the lab app's Page Objects with, is not built. Run pnpm lab:prepare in apps/lab-formbricks.";
    return null;
  },
};

/** The server, built, and the range a page scans, free. */
export const aymeMcpPreconditions: Precondition[] = [
  aymeMcpBuiltPrecondition,
  aymeMcpPortsPrecondition,
];

/**
 * The arms with the page's tools through WebMCP run the server too, to serve
 * the Page Objects, and the runtime it serves loads `@ayme-dev/webmcp` in the
 * page once `--webmcp` turns publication on.
 */
export const aymeWebMcpPreconditions: Precondition[] = [
  aymeMcpBuiltPrecondition,
  {
    name: "Ayme WebMCP package",
    check: () =>
      resolvesFromLab("@ayme-dev/webmcp")
        ? null
        : "@ayme-dev/webmcp, which the served runtime publishes through WebMCP with, is not built. Run pnpm lab:prepare in apps/lab-formbricks.",
  },
  aymeMcpPortsPrecondition,
];

/** What every setup that serves the Page Objects records of the server and the pairing. */
type ServedEvidence = {
  server: { name: string; version: string; port: number };
  /** What the server served the page: the entry, relative to the lab app's folder, and whether with `--webmcp`. */
  served: { entry: string; webmcp: boolean };
  page: { url: string };
  /** The page paired with the server before the agent started. */
  paired: true;
  pairedAt: string;
  /** From opening the start page to the pairing. */
  pairingMs: number;
  /** The harness never turns a Goal Loop on, and the lab app has none, so the page never offers `goal`. */
  goalToolPublished: false;
};

/** What the setup established before the measured window, recorded in the result. */
export type AymeEvidence = ServedEvidence & {
  /** The page's tool names as the server lists them to the agent, without the server's own tools. */
  tools: string[];
  /** Whether the server served the lab app's Page Objects; without them the page offered no Page Object Tool. */
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
  pageObjects: boolean;
  /** Extra arguments for the headless browser the page opens in. */
  browserArgs?: string[];
  /** Extra Chrome features, joined into the WebMCP flag's `--enable-features` switch. */
  browserFeatures?: string[];
  /** Whether the proxy offers the agent the page's Page Object Tools alone. */
  pageObjectToolsOnly?: boolean;
};

type Page = ReturnType<BrowserContext["pages"]>[number];

/**
 * The page's current tool names as WebMCP publishes them, read from
 * `document.modelContext`: the Page Object Tools of the screen and the read
 * tool `page_objects`, once the page is served with `--webmcp`, and nothing
 * otherwise.
 */
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
 * The page's tools among the names the server lists: every name but the
 * server's own tools, which all start with `ayme_`.
 */
export function pageToolNames(listed: string[]): string[] {
  return listed.filter((name) => !name.startsWith("ayme_")).sort();
}

/**
 * What is wrong with a start page without page objects, looked at again after pairing: it must
 * still offer its screen tool, without goal, and no Page Object
 * Tool, keep this run's pairing, and stay at the start URL. Null when nothing is.
 */
export function settledStartPageProblem(look: {
  tools: string[];
  screenTool: string;
  pairedAddress: string;
  storedAddress: string | null;
  pageUrl: string;
  startUrl: string;
}): string | null {
  const pageObjectTools = pageObjectToolNames(look.tools);
  if (pageObjectTools.length > 0)
    return `The page offers ${pageObjectTools.join(", ")} although the server serves no Page Objects.`;
  if (!look.tools.includes(look.screenTool) || look.tools.includes("goal"))
    return `The page offers ${look.tools.join(", ") || "nothing"} two seconds after pairing, instead of ${look.screenTool} without goal.`;
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
 * The `ayme mcp` server as the harness runs it: started in the lab app's
 * folder on `port`, serving the entry for the arm, its stderr kept in the
 * run folder. It leads a process group of its own, so that stopping it
 * stops the esbuild service it starts too (see `processGroup.ts`). Until an
 * agent connects to its socket, if one ever does, the harness itself may ask
 * it for its tool list; then its stdio is handed to the first client of the
 * socket. Whatever else the server writes before that client connects is
 * dropped: a server that paired before any agent existed announces the
 * tool-list change to nobody, and the agent's first tool list reflects it.
 */
class HarnessedServer {
  readonly process: ChildProcess;
  readonly log: string[] = [];
  private readonly stopProcess: () => Promise<{ stdioHeldOpen: boolean }>;
  private agent: net.Socket | undefined;
  private listener: net.Server | undefined;
  private pendingOutput = "";
  private readonly context: Pick<ArmContext, "log">;
  /** Whether an agent will be given the server; without one, what it writes is nobody's. */
  private readonly forAgent: boolean;
  /** The harness's own requests the server has yet to answer, by id. */
  private readonly requests = new Map<
    string,
    (message: { result?: unknown; error?: unknown }) => void
  >();
  private requestCount = 0;

  constructor(
    port: number,
    served: ServedPageObjects,
    context: Pick<ArmContext, "log">,
    forAgent: boolean
  ) {
    this.context = context;
    this.forAgent = forAgent;
    const group = spawnProcessGroup(
      process.execPath,
      [aymeMcpCliPath, ...aymeMcpArgs(port, served)],
      {
        // Where the server finds the Page Objects it serves and writes its init script.
        cwd: labRoot,
        // Scrubbed, so the server carries none of the launcher's Claude Code variables or token.
        env: withoutClaudeVariables(process.env),
      }
    );
    this.process = group.child;
    this.stopProcess = group.stop;
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
      const dropped = lines.filter((line) => !this.answered(line));
      if (dropped.length > 0 && this.forAgent)
        this.context.log(
          `Dropped ${dropped.length} message(s) the Ayme MCP server sent before the agent connected.`
        );
    });
  }

  /** Whether `line` answers one of the harness's own requests, which it then settles. */
  private answered(line: string): boolean {
    let message: { id?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return false;
    }
    const settle =
      typeof message.id === "string" ? this.requests.get(message.id) : null;
    if (!settle) return false;
    this.requests.delete(message.id as string);
    settle(message);
    return true;
  }

  /**
   * The names of the tools the server lists now, as an agent's `tools/list`
   * reads them. Only before the agent connects. The harness asks without an
   * `initialize`, which the server answers all the same, so the agent's own
   * `initialize` stays the session's one. The server notes these tools as
   * shown to its agent; the agent's own first list, which Claude Code reads
   * as it starts, notes the same.
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
        if (Array.isArray(tools)) resolve(tools.map((tool) => tool.name));
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

  /**
   * Closes the socket and ends the server with whatever it started, a
   * server that ended by itself when its agent left included: its esbuild
   * service inherits its standard error, and one left behind would keep the
   * harness's end of that pipe, and so the harness, from ever ending.
   */
  async stop(socketPath: string): Promise<void> {
    this.listener?.close();
    this.agent?.destroy();
    await rm(socketPath, { force: true });
    const { stdioHeldOpen } = await this.stopProcess();
    if (stdioHeldOpen)
      this.context.log(
        "A process the Ayme MCP server started left the server's process group and still holds its output open; the harness let go of it instead of waiting. Look for a stray process of this run."
      );
  }
}

/**
 * The Ayme arms' setup: the shipped skill in the run's configuration folder,
 * then the server and the page from `setUpAymePage`.
 */
export async function setUpAymeAgent(
  context: ArmContext,
  options: { pageObjects: boolean }
): Promise<ArmSetup> {
  // The shipped skill with its references, read from the fresh configuration folder, as the
  // Playwright CLI arm's skill is.
  const skillDir = aymeSkillDirectory(context.configDir);
  await cp(aymeSkillSource, skillDir, { recursive: true });
  const { evidence, dispose } = await setUpAymePage(context, options);
  return {
    environment: {},
    readableDirectories: [skillDir],
    evidence,
    dispose,
  };
}

/**
 * Launches the headless system Chrome on the run's profile, with the arm's
 * browser arguments and the WebMCP flag, and opens the mission's start page.
 * With `initScript`, the run's server's, every document of the browser's
 * pages runs it first, in a context that lets it reach the server: the page
 * the harness opens here, and whatever the agent's own browser tool,
 * attached to this browser over CDP, navigates it to or opens beside it,
 * since the harness stays attached for the run. Without it the page is
 * Formbricks as it is, with nothing of Ayme.
 */
export async function launchStartPage(
  context: Pick<ArmContext, "profileDir" | "start">,
  options: Pick<AymePageOptions, "browserArgs" | "browserFeatures"> & {
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

/**
 * What is wrong with the init script the run's server wrote: it must name
 * the run's port, and turn WebMCP publication on exactly when the arm wants
 * it. Null when nothing is.
 */
export function initScriptProblem(
  script: string,
  expected: { port: number; webmcp: boolean }
): string | null {
  if (!script.includes(`http://127.0.0.1:${expected.port}/`))
    return `The init script at ${initScriptPath} does not name this run's server on port ${expected.port}.`;
  const webmcp = /webMCP:\s*\{\s*enabled:\s*true\s*\}/.test(script);
  if (webmcp !== expected.webmcp)
    return `The init script at ${initScriptPath} turns WebMCP publication ${webmcp ? "on" : "off"}, and this arm needs it ${expected.webmcp ? "on" : "off"}.`;
  return null;
}

/** The run's server and the start page paired with it, before anything reads the page's tools. */
type ServedStartPage = {
  server: HarnessedServer;
  page: Page;
  /** The address of the run's server, which the tab keeps its pairing with. */
  pairedAddress: string;
  /** What every such setup records; the caller adds what it read of the page's tools. */
  evidence: ServedEvidence;
  /** When the start page was opened, for the time the tools took. */
  opened: number;
  /** Writes the server's log into the run folder. */
  writeLog: () => Promise<void>;
  dispose: () => Promise<void>;
};

/**
 * Starts the run's `ayme mcp` in the lab app's folder, before the browser,
 * waits for the init script it writes, launches the browser with that init
 * script on the mission's start page, and waits until the page has paired
 * with the server. With `agentProxy`, the server's stdio is the agent's,
 * through the proxy written into the run folder; without it, the server
 * serves the page and no agent is given it. Disposes of what it started
 * when it fails.
 */
async function openServedStartPage(
  context: ArmContext,
  options: ServedPageObjects &
    Pick<AymePageOptions, "browserArgs" | "browserFeatures"> & {
      agentProxy?: { pageObjectToolsOnly: boolean };
    }
): Promise<ServedStartPage> {
  const socketPath = agentSocketPath(context.runId);
  const logPath = path.join(context.runDir, "ayme-mcp.log");

  // Re-checked here: the precondition ran before the seed, and only one server may be in the range.
  const inUse = await portsInUse();
  if (inUse.length > 0)
    throw new Error(
      `Something listens on port ${inUse.join(", ")}, in the range a page scans for Ayme MCP servers. Stop it and run again.`
    );
  const port = serverPorts.first;
  // An earlier server's init script, which may name another port or another WebMCP setting.
  await rm(initScriptPath, { force: true });
  const server = new HarnessedServer(
    port,
    options,
    context,
    options.agentProxy !== undefined
  );
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
      `Ayme MCP server listening on port ${port}, serving ${options.pageObjects ? pageObjectsEntry : noPageObjectsEntry}${options.webmcp ? " with --webmcp" : ""}.`
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
      webmcp: options.webmcp,
    });
    if (problem) throw new Error(problem);
    if (options.agentProxy) {
      await mkdir(context.runDir, { recursive: true });
      await writeFile(
        proxyScriptPath(context.runDir),
        proxyScript(options.agentProxy)
      );
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
    const pairedAddress = `ws://127.0.0.1:${port}`;
    if (pairing.address !== pairedAddress)
      throw new Error(
        `The page paired with ${pairing.address} instead of this run's server on port ${port}.`
      );
    if (!server.log.some((line) => line.includes("A page connected.")))
      throw new Error(
        `The page stored a pairing but the server did not report it. Server log:\n${server.log.join("\n")}`
      );
    return {
      server,
      page,
      pairedAddress,
      evidence: {
        server: { name: aymeMcpPackageName, version: aymeMcpVersion(), port },
        served: {
          entry: options.pageObjects ? pageObjectsEntry : noPageObjectsEntry,
          webmcp: options.webmcp,
        },
        page: { url: page.url() },
        paired: true,
        pairedAt: pairedAt.toISOString(),
        pairingMs: pairedAt.getTime() - opened,
        goalToolPublished: false,
      },
      opened,
      writeLog,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/**
 * The server and the page of the arms whose agent gets the `ayme` server:
 * the start page paired with the run's server (`openServedStartPage`), then
 * the wait until the server lists the start screen's tools, read from the
 * server as the agent will read them, since the page publishes nothing
 * through WebMCP here. The server is handed to the agent through the proxy
 * in the run folder.
 */
export async function setUpAymePage(
  context: ArmContext,
  options: AymePageOptions
): Promise<Pick<ArmSetup, "dispose"> & { evidence: AymeEvidence }> {
  const pageObjectToolsOnly = options.pageObjectToolsOnly === true;
  const screenTool = options.pageObjects
    ? startScreenTool[context.start.screen]
    : "snapshot";
  const served = await openServedStartPage(context, {
    pageObjects: options.pageObjects,
    webmcp: false,
    browserArgs: options.browserArgs,
    browserFeatures: options.browserFeatures,
    agentProxy: { pageObjectToolsOnly },
  });
  const { server, page, pairedAddress } = served;
  const listedTools = async () => pageToolNames(await server.listToolNames());
  try {
    let tools = await waitFor(
      `Listing ${screenTool}`,
      60_000,
      async () => {
        const names = await listedTools();
        return names.includes(screenTool) ? names : null;
      },
      (last) =>
        ` The server listed ${last?.join(", ") || "no tool of the page"}. Server log:\n${server.log.join("\n")}`
    );
    if (tools.includes("goal"))
      throw new Error(
        `The page offers goal although the lab app has no Goal Loop (${context.runId}).`
      );
    if (!options.pageObjects) {
      // The runtime offers a screen's Page Object Tools as it finds the screen, so look again once
      // they would have had time to appear. That second look is the one recorded, so it must still
      // show a complete, paired start page.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      tools = await listedTools();
      const problem = settledStartPageProblem({
        tools,
        screenTool,
        pairedAddress,
        storedAddress: (await storedPairing(page))?.address ?? null,
        pageUrl: page.url(),
        startUrl: context.start.url,
      });
      if (problem) throw new Error(`${problem} (${context.runId})`);
    }
    context.log(
      `The start page paired with the Ayme MCP server ${served.evidence.pairingMs} ms after opening, and the server lists ${tools.length} tools of it; Page Objects are ${options.pageObjects ? "served" : "not served"}.`
    );
    if (pageObjectToolsOnly)
      context.log(
        `The proxy offers the agent the Page Object Tools alone: ${pageObjectToolNames(tools).join(", ")}.`
      );
    await served.writeLog();
    const evidence: AymeEvidence = {
      ...served.evidence,
      page: { url: page.url() },
      tools,
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
    return { evidence, dispose: served.dispose };
  } catch (error) {
    await served.dispose();
    throw error;
  }
}

/**
 * What the setup of an arm with the page's tools through WebMCP established,
 * recorded in the result. The run's server served the Page Objects with
 * `--webmcp` and the page paired with it, but no agent was given the server:
 * the page's tools reach the agent through its browser tool's WebMCP support
 * alone.
 */
export type WebMcpEvidence = ServedEvidence & {
  /** From opening the start page to the start screen's Page Object Tool being published. */
  publishedMs: number;
  /** The page's tool names as WebMCP publishes them, read from `document.modelContext`. */
  tools: string[];
  pageObjects: true;
  /** The flag the browser was launched with, and the Page Object Tools among the start screen's tools. */
  webmcp: { browserFlag: string; pageObjectTools: string[] };
};

/**
 * The server and the page of the arms with the page's tools through WebMCP:
 * the start page paired with the run's server (`openServedStartPage`),
 * which serves the lab app's Page Objects with `--webmcp`, on a Chrome with
 * the WebMCP flag as every launch has it, then the wait until the page
 * publishes the start screen's Page Object Tool through
 * `document.modelContext`, where the agent's browser tool reads it. The
 * server serves the files and keeps the pairing; no proxy is written and no
 * agent is given it.
 */
export async function setUpWebMcpPage(
  context: ArmContext,
  options: { browserArgs: string[]; browserFeatures?: string[] }
): Promise<Pick<ArmSetup, "dispose"> & { evidence: WebMcpEvidence }> {
  const screenTool = startScreenTool[context.start.screen];
  const served = await openServedStartPage(context, {
    pageObjects: true,
    webmcp: true,
    browserArgs: options.browserArgs,
    browserFeatures: options.browserFeatures,
  });
  const { server, page } = served;
  try {
    const tools = await waitFor(
      `Publishing ${screenTool} through WebMCP`,
      60_000,
      async () => {
        const names = await publishedToolNames(page);
        return names.includes(screenTool) ? names : null;
      },
      (last) =>
        ` The page published ${last?.join(", ") || "nothing"}. The browser must supply document.modelContext, as Chrome does with ${webMcpFeatureFlag}. Server log:\n${server.log.join("\n")}`
    );
    const publishedMs = Date.now() - served.opened;
    if (tools.includes("goal"))
      throw new Error(
        `The page publishes goal although the lab app has no Goal Loop (${context.runId}).`
      );
    const pageObjectTools = pageObjectToolNames(tools);
    context.log(
      `The start page paired with the Ayme MCP server and published ${tools.length} tools through WebMCP ${publishedMs} ms after opening, the Page Object Tools ${pageObjectTools.join(", ")} among them; no agent is given the server.`
    );
    await served.writeLog();
    const evidence: WebMcpEvidence = {
      ...served.evidence,
      page: { url: page.url() },
      publishedMs,
      tools,
      pageObjects: true,
      webmcp: { browserFlag: webMcpFeatureFlag, pageObjectTools },
    };
    return { evidence, dispose: served.dispose };
  } catch (error) {
    await served.dispose();
    throw error;
  }
}
