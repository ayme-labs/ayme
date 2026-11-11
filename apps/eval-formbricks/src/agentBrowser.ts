/**
 * Everything the agent-browser arms set up before the measured window: the
 * `agent-browser` command on the agent's PATH, its skill in the run's Claude
 * Code configuration folder, and a session attached over CDP to the browser
 * the harness launched on the mission's start page. agent-browser never
 * launches or downloads a browser of its own, and the measured agent
 * installs nothing. The baseline's page is Formbricks as it is. The arms with
 * Ayme's Page Object Tools get them served into their page by the run's
 * `ayme mcp`: the one through WebMCP has agent-browser's WebMCP support on,
 * which is off for the baseline, and the one through the `ayme` server
 * leaves it off and gets that server beside the command.
 */
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ArmContext, ArmSetup } from "./arms.ts";
import { launchStartPage, setUpAymePage, setUpWebMcpPage } from "./ayme.ts";
import { withoutClaudeVariables } from "./claude.ts";
import { freeLoopbackPort } from "./playwrightMcp.ts";

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const packagePath = require.resolve("agent-browser/package.json");
export const agentBrowserRoot = path.dirname(packagePath);

export function agentBrowserVersion(): string {
  const manifest = require(packagePath) as { version: string };
  return manifest.version;
}

/**
 * The skill the package ships: a stub that sends the agent to `agent-browser
 * skills get core`, which serves the package's `skill-data/` guides.
 */
const skillSource = path.join(agentBrowserRoot, "skills/agent-browser");

/** Where Claude Code loads user skills from, inside the run's configuration folder. */
export function skillDirectory(configDir: string) {
  return path.join(configDir, "skills/agent-browser");
}

export function shimDirectory(runDir: string) {
  return path.join(runDir, "bin");
}

/**
 * The package's native binary for this machine. The package ships one per
 * platform; its install script, which pnpm does not run, only marks it
 * executable, and a global install points the command at it directly.
 */
export function nativeBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  const extension = platform === "win32" ? ".exe" : "";
  return path.join(
    agentBrowserRoot,
    "bin",
    `agent-browser-${platform}-${arch}${extension}`
  );
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A one-line `agent-browser` executable, so the agent's PATH holds that command and nothing else of this package's. */
export function shimScript(binary: string = nativeBinary()) {
  return `#!/bin/sh\nexec ${shellQuote(binary)} "$@"\n`;
}

/**
 * agent-browser refuses a session whose socket path would pass 103 bytes, as
 * macOS caps a socket path there, and puts the session's name in that path.
 * A run id is far longer, so the session is named after its random suffix.
 */
export function sessionName(runId: string) {
  return `eval-${runId.slice(-6)}`;
}

/**
 * The prefix of the folder, made with `mkdtemp` for each run, where the run's
 * agent-browser daemons keep their sockets: short, in the temporary folder,
 * since a run folder's path is too long, and the run's own, so a session the
 * agent names itself never reaches another run's daemon.
 */
export function socketDirectoryPrefix() {
  return path.join(os.tmpdir(), "ab-");
}

/**
 * agent-browser's configuration, from the environment, so the setup and the
 * agent share it. The session is named after the run (`sessionName`), so
 * the plain command reaches it. Every session, one the agent names itself included, attaches
 * over CDP to the browser on `cdpPort` instead of launching one, and a
 * session that has lost that browser fails rather than launching another.
 * Screenshots go to the run's output folder. The outdated-Chrome check and
 * its request to Google are off. agent-browser's WebMCP support stays off
 * unless `webmcp` says otherwise: with it, the agent reaches the tools the
 * served Page Objects publish through `agent-browser webmcp list` and
 * `webmcp invoke`.
 */
export function agentBrowserEnvironment(
  context: Pick<ArmContext, "runId" | "runDir" | "outputDir">,
  parentPath: string = process.env.PATH ?? "",
  options: { cdpPort: number; socketDir: string; webmcp: boolean }
): Record<string, string> {
  return {
    PATH: `${shimDirectory(context.runDir)}${path.delimiter}${parentPath}`,
    AGENT_BROWSER_SESSION: sessionName(context.runId),
    AGENT_BROWSER_CDP: String(options.cdpPort),
    AGENT_BROWSER_SOCKET_DIR: options.socketDir,
    AGENT_BROWSER_SCREENSHOT_DIR: context.outputDir,
    AGENT_BROWSER_NO_VERSION_CHECK: "1",
    ...(options.webmcp ? {} : { AGENT_BROWSER_NO_WEBMCP: "1" }),
  };
}

async function runCli(
  context: ArmContext,
  environment: Record<string, string>,
  args: string[]
) {
  // The agent's working directory, and a scrubbed environment, so the daemon this starts carries
  // none of the launcher's Claude Code variables or token.
  const { stdout } = await execFileAsync(
    path.join(shimDirectory(context.runDir), "agent-browser"),
    args,
    {
      cwd: context.cwd,
      env: { ...withoutClaudeVariables(process.env), ...environment },
      timeout: 120_000,
    }
  );
  return stdout;
}

/** The command and the skill, as for the Playwright CLI arm. Returns the skill's folder. */
async function installCliAndSkill(context: ArmContext): Promise<string> {
  await mkdir(shimDirectory(context.runDir), { recursive: true });
  await chmod(nativeBinary(), 0o755);
  const shim = path.join(shimDirectory(context.runDir), "agent-browser");
  await writeFile(shim, shimScript());
  await chmod(shim, 0o755);
  const skillDir = skillDirectory(context.configDir);
  await cp(skillSource, skillDir, { recursive: true });
  return skillDir;
}

/**
 * The Chrome features agent-browser's WebMCP support needs besides WebMCP
 * itself: it discovers the page's tools through Chrome's experimental
 * DevTools `WebMCP` domain (`toolsAdded`, `toolsRemoved`, `invokeTool`),
 * which only these two features expose, and it adds them to a browser it
 * launches itself. An attached browser without them makes `WebMCP.enable`
 * fail once; agent-browser then treats the session as unsupported, never
 * announces the page's tools after a command, and `webmcp list` fails. The
 * twin with WebMCP on passes them to the harness's browser, so the attached
 * browser matches one agent-browser launches.
 */
export const agentBrowserWebMcpFeatures = [
  "WebMCPTesting",
  "DevToolsWebMCPSupport",
];

/**
 * The baseline's page: Formbricks as it is, on the harness's browser. No
 * init script and no `ayme mcp`, so nothing of Ayme reaches the page.
 */
async function setUpPlainPage(
  context: ArmContext,
  browserArgs: string[]
): Promise<Pick<ArmSetup, "dispose"> & { evidence: Record<string, unknown> }> {
  const { browser, page } = await launchStartPage(context, { browserArgs });
  return {
    evidence: { server: null, page: { url: page.url() }, paired: false },
    dispose: async () => {
      try {
        await browser.close();
      } catch (error) {
        context.log(
          `Closing the agent-browser arm's browser failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}

/** What an agent-browser arm adds to the baseline, if anything. */
type AymeTools = "none" | "webmcp" | "server";

/**
 * The setup of every agent-browser arm: the start page on a Chrome the
 * harness launches with the WebMCP flag and a remote-debugging port, then
 * the run's session attached to that browser. The baseline's page is
 * Formbricks as it is (`setUpPlainPage`); the twin through WebMCP gets the
 * page of the arms with the page's tools through WebMCP (`setUpWebMcpPage`:
 * the lab app's Page Objects served with `--webmcp` by the run's `ayme mcp`,
 * which no agent is given), and the twin with the `ayme` server the page of
 * the arms with that server (`setUpAymePage`: the same Page Objects served
 * with `--only-page-object-tools` by a server the agent gets), with
 * agent-browser's WebMCP support off as for the baseline. The session
 * starts with `get url`, which attaches and adopts the open tab without
 * navigating it; `open` would load the page again. The URL it reports must
 * be the start page. After the run every session in the run's socket folder
 * is closed, which detaches without closing the browser, and then the
 * browser is.
 */
async function setUpAgentBrowser(
  context: ArmContext,
  options: { ayme: AymeTools }
): Promise<ArmSetup> {
  const webmcp = options.ayme === "webmcp";
  const port = await freeLoopbackPort();
  const skillDir = await installCliAndSkill(context);
  const socketDir = await mkdtemp(socketDirectoryPrefix());
  const environment = agentBrowserEnvironment(context, undefined, {
    cdpPort: port,
    socketDir,
    webmcp,
  });
  const browserArgs = [`--remote-debugging-port=${port}`];
  let page: Awaited<ReturnType<typeof setUpPlainPage>>;
  try {
    page = webmcp
      ? await setUpWebMcpPage(context, {
          browserArgs,
          browserFeatures: agentBrowserWebMcpFeatures,
        })
      : options.ayme === "server"
        ? await setUpAymePage(context, { browserArgs })
        : await setUpPlainPage(context, browserArgs);
  } catch (error) {
    await rm(socketDir, { recursive: true, force: true });
    throw error;
  }
  const dispose = async () => {
    try {
      await runCli(context, environment, ["close", "--all"]);
    } catch (error) {
      context.log(
        `Closing the agent-browser sessions failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    await rm(socketDir, { recursive: true, force: true });
    await page.dispose();
  };
  try {
    context.log(
      `Attaching the agent-browser session "${environment.AGENT_BROWSER_SESSION}" over CDP on port ${port}, its WebMCP support ${webmcp ? "on" : "off"}.`
    );
    const pageUrl = (await runCli(context, environment, ["get", "url"])).trim();
    if (
      !URL.canParse(pageUrl) ||
      new URL(pageUrl).pathname !== new URL(context.start.url).pathname
    )
      throw new Error(
        `agent-browser reported ${pageUrl || "no page"} instead of the start page at ${context.start.url}.`
      );
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    environment,
    readableDirectories: [context.outputDir, skillDir],
    evidence: {
      ...page.evidence,
      remoteDebuggingPort: port,
      agentBrowserWebMcp: webmcp,
      browserFeatures: webmcp ? agentBrowserWebMcpFeatures : [],
    },
    dispose,
  };
}

/** The baseline: agent-browser on the harness's browser, on Formbricks as it is, its WebMCP support off. */
export function setUpAgentBrowserBaseline(
  context: ArmContext
): Promise<ArmSetup> {
  return setUpAgentBrowser(context, { ayme: "none" });
}

/** The twin with the served Page Objects' tools through agent-browser's WebMCP support. */
export function setUpAgentBrowserWithAymeWebMcp(
  context: ArmContext
): Promise<ArmSetup> {
  return setUpAgentBrowser(context, { ayme: "webmcp" });
}

/**
 * The twin with the served Page Objects' tools through the `ayme` server:
 * the server and the page of `setUpAymePage`, and agent-browser as for the
 * baseline, its WebMCP support off.
 */
export function setUpAgentBrowserWithAymePageObjects(
  context: ArmContext
): Promise<ArmSetup> {
  return setUpAgentBrowser(context, { ayme: "server" });
}
