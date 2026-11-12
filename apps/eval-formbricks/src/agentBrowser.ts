/**
 * Everything the agent-browser arms set up before the measured window: the
 * `agent-browser` command on the agent's PATH, its skill in the run's Claude
 * Code configuration folder, and a session attached over CDP to the browser
 * the harness launched on the mission's start page. agent-browser never
 * launches or downloads a browser of its own, and the measured agent
 * installs nothing. The arm alone gets Formbricks as it is, its WebMCP
 * support off. The arms with Ayme get the lab app's Page Objects served
 * into their page by the run's `ayme mcp`: through WebMCP, with
 * agent-browser's WebMCP support on, or through the `ayme` server, with it
 * off.
 */
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ArmContext, ArmSetup } from "./arms.ts";
import {
  installAymeSkill,
  launchStartPage,
  setUpAymePage,
  type AymeChannel,
} from "./ayme.ts";
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

/** The skill the package ships: a stub that sends the agent to `agent-browser skills get core`. */
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
 * executable.
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
 * agent-browser refuses a session whose socket path would pass 103 bytes,
 * and puts the session's name in that path, so the session is named after
 * the run id's random suffix.
 */
export function sessionName(runId: string) {
  return `eval-${runId.slice(-6)}`;
}

/**
 * agent-browser's configuration, from the environment, so the setup and the
 * agent share it. Every session attaches over CDP to the browser on
 * `cdpPort` instead of launching one. Its sockets live in the run's own
 * short folder. Screenshots go to the run's output folder. The version check
 * is off. Its WebMCP support stays off unless `webmcp`: with it, `webmcp
 * list` and `webmcp invoke` reach the tools the page publishes.
 */
export function agentBrowserEnvironment(
  context: Pick<ArmContext, "runId" | "runDir" | "outputDir">,
  parentPath: string,
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

/**
 * The Chrome features agent-browser's WebMCP support needs besides WebMCP:
 * it discovers the page's tools through Chrome's experimental DevTools
 * `WebMCP` domain, which only these expose, and adds them to a browser it
 * launches itself. The arm through WebMCP passes them to the harness's
 * browser, so the attached browser matches one agent-browser launches.
 */
export const agentBrowserWebMcpFeatures = [
  "WebMCPTesting",
  "DevToolsWebMCPSupport",
];

async function runCli(
  context: ArmContext,
  environment: Record<string, string>,
  args: string[]
) {
  // A scrubbed environment, so the daemon this starts carries none of the launcher's Claude Code variables or token.
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

/** The page of the arm alone: Formbricks as it is, on the harness's browser, with nothing of Ayme. */
async function setUpPlainPage(
  context: ArmContext,
  browserArgs: string[]
): Promise<{
  evidence: Record<string, unknown>;
  dispose: () => Promise<void>;
}> {
  const { browser, page } = await launchStartPage(context, { browserArgs });
  return {
    evidence: { page: { url: page.url() } },
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

/**
 * The setup of every agent-browser arm: the start page on a Chrome the
 * harness launches with a remote-debugging port, then the run's session
 * attached to it. Without Ayme the page is Formbricks as it is; with it, the
 * page paired with the run's `ayme mcp`, started as the skill reference says
 * for the channel, and the `ayme` skill beside agent-browser's. The session
 * starts with `get url`, which attaches and adopts the open tab without
 * navigating it, and must report the start page. After the run every session
 * in the run's socket folder is closed, which detaches, and then the browser
 * is.
 */
async function setUpAgentBrowser(
  context: ArmContext,
  channel: AymeChannel | null
): Promise<ArmSetup> {
  const webmcp = channel === "webmcp";
  const port = await freeLoopbackPort();
  const skillDir = await installCliAndSkill(context);
  const aymeSkillDir =
    channel === null ? null : await installAymeSkill(context.configDir);
  const socketDir = await mkdtemp(path.join(os.tmpdir(), "ab-"));
  const environment = agentBrowserEnvironment(context, process.env.PATH ?? "", {
    cdpPort: port,
    socketDir,
    webmcp,
  });
  const browserArgs = [`--remote-debugging-port=${port}`];
  let page: Awaited<ReturnType<typeof setUpPlainPage>>;
  try {
    page =
      channel === null
        ? await setUpPlainPage(context, browserArgs)
        : await setUpAymePage(context, {
            channel,
            browserArgs,
            browserFeatures: webmcp ? agentBrowserWebMcpFeatures : [],
          });
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
    readableDirectories: [
      context.outputDir,
      skillDir,
      ...(aymeSkillDir === null ? [] : [aymeSkillDir]),
    ],
    evidence: {
      ...page.evidence,
      remoteDebuggingPort: port,
      agentBrowserWebMcp: webmcp,
    },
    dispose,
  };
}

/** The arm alone: agent-browser on the harness's browser, on Formbricks as it is, its WebMCP support off. */
export function setUpAgentBrowserAlone(context: ArmContext) {
  return setUpAgentBrowser(context, null);
}

/** An arm with Ayme, through the given channel. */
export function setUpAgentBrowserWithAyme(
  context: ArmContext,
  channel: AymeChannel
) {
  return setUpAgentBrowser(context, channel);
}
