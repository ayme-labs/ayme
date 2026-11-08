/**
 * Everything the Playwright CLI arm sets up before the measured window: the
 * `playwright-cli` command on the agent's PATH, the CLI's official skill in the
 * run's Claude Code configuration folder, and a browser session already open
 * on the mission's start page. The measured agent installs and downloads
 * nothing. The arm that adds Ayme's Page Object Tools to the CLI shares all
 * of it, with the session attached to the browser that paired with the run's
 * `ayme mcp` instead of one the CLI launches.
 */
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { ArmContext, ArmSetup } from "./arms.ts";
import { setUpAymePage } from "./ayme.ts";
import { withoutClaudeVariables } from "./claude.ts";
import { cdpEndpoint, freeLoopbackPort } from "./playwrightMcp.ts";

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const packagePath = require.resolve("@playwright/cli/package.json");
export const playwrightCliRoot = path.dirname(packagePath);

export function playwrightCliVersion(): string {
  const manifest = require(packagePath) as { version: string };
  return manifest.version;
}

/** The skill the package ships; the same files `playwright-cli install --skills` writes. */
const skillSource = path.join(playwrightCliRoot, "skills/playwright-cli");

/** Where Claude Code loads user skills from, inside the run's configuration folder. */
export function skillDirectory(configDir: string) {
  return path.join(configDir, "skills/playwright-cli");
}

export function shimDirectory(runDir: string) {
  return path.join(runDir, "bin");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A one-line `playwright-cli` executable, so the agent's PATH holds that command and nothing else of this package's. */
export function shimScript() {
  return `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(playwrightCliRoot, "playwright-cli.js"))} "$@"\n`;
}

/**
 * The CLI's configuration, from the environment: its daemon reads these when a
 * session starts, so the setup and the agent share them. The session is named
 * after the run, so the plain command reaches it. The profile is the one the
 * harness prepared, even if the agent restarts the browser; with a CDP
 * endpoint instead, the daemon attaches to the browser already running
 * there, and a restart attaches again, so the browser and profile switches,
 * which describe a launch that never happens, are left out. The page's WebMCP
 * tools stay off: the lab app registers Ayme's, and the agent gets them, if
 * at all, through the `ayme` server.
 */
export function playwrightCliEnvironment(
  context: Pick<ArmContext, "runId" | "runDir" | "profileDir" | "outputDir">,
  parentPath: string = process.env.PATH ?? "",
  options: { cdpEndpoint?: string } = {}
): Record<string, string> {
  return {
    // No update check on the network, no download.
    NO_UPDATE_NOTIFIER: "1",
    PATH: `${shimDirectory(context.runDir)}${path.delimiter}${parentPath}`,
    PLAYWRIGHT_CLI_SESSION: context.runId,
    ...(options.cdpEndpoint === undefined
      ? {
          // The system Chrome, like the other arms. Its Playwright is the one that prepared the profile, from the same pinned build.
          PLAYWRIGHT_MCP_BROWSER: "chrome",
          PLAYWRIGHT_MCP_USER_DATA_DIR: context.profileDir,
        }
      : { PLAYWRIGHT_MCP_CDP_ENDPOINT: options.cdpEndpoint }),
    PLAYWRIGHT_MCP_OUTPUT_DIR: context.outputDir,
    PLAYWRIGHT_MCP_WEBMCP: "false",
  };
}

/** `- Page URL: <url>` from a command's text output. */
export function parsePageUrl(output: string): string | null {
  const match = /^- Page URL: (.+)$/m.exec(output);
  return match?.[1]?.trim() ?? null;
}

async function runCli(
  context: ArmContext,
  environment: Record<string, string>,
  args: string[]
) {
  // The agent's working directory: the CLI finds its sessions by workspace. A scrubbed environment,
  // so the browser daemon this starts carries none of the launcher's Claude Code variables or token.
  const { stdout } = await execFileAsync(
    path.join(shimDirectory(context.runDir), "playwright-cli"),
    args,
    {
      cwd: context.cwd,
      env: { ...withoutClaudeVariables(process.env), ...environment },
      timeout: 120_000,
    }
  );
  return stdout;
}

/**
 * The command and the skill: the shim in the run folder, first on the agent's
 * PATH, and the package's skill in the run's fresh configuration folder,
 * where only this arm's run has one. Returns the skill's folder.
 */
async function installCliAndSkill(context: ArmContext): Promise<string> {
  await mkdir(shimDirectory(context.runDir), { recursive: true });
  const shim = path.join(shimDirectory(context.runDir), "playwright-cli");
  await writeFile(shim, shimScript());
  await chmod(shim, 0o755);
  const skillDir = skillDirectory(context.configDir);
  await cp(skillSource, skillDir, { recursive: true });
  return skillDir;
}

/**
 * Starts the run's session with `command` (`open` on the start page, or
 * `attach` to a browser already holding it), checks that the page the CLI
 * reports is the start page, and returns how to close the session. The
 * session is stopped when the check fails.
 */
async function startSession(
  context: ArmContext,
  environment: Record<string, string>,
  command: string[]
): Promise<{ dispose: () => Promise<void> }> {
  const dispose = async () => {
    try {
      await runCli(context, environment, ["close"]);
    } catch (error) {
      context.log(
        `Closing the Playwright CLI session failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  context.log(
    `Starting the Playwright CLI session "${context.runId}" with ${command[0]}.`
  );
  try {
    const output = await runCli(context, environment, command);
    const pageUrl = parsePageUrl(output);
    if (
      pageUrl === null ||
      new URL(pageUrl).pathname !== new URL(context.start.url).pathname
    )
      throw new Error(
        `The Playwright CLI ${command[0]} reported ${pageUrl ?? "no page"} instead of the start page at ${context.start.url}.`
      );
  } catch (error) {
    await dispose();
    throw error;
  }
  return { dispose };
}

export async function setUpPlaywrightCli(
  context: ArmContext
): Promise<ArmSetup> {
  const environment = playwrightCliEnvironment(context);
  const skillDir = await installCliAndSkill(context);
  const { dispose } = await startSession(context, environment, [
    "open",
    context.start.url,
  ]);
  return {
    environment,
    readableDirectories: [context.outputDir, skillDir],
    dispose,
  };
}

/**
 * The setup of the CLI arm with Ayme's Page Object Tools: the Ayme server
 * and the page as for the Ayme arms, with the page objects on and the Goal
 * Loop off, the browser listening on a remote-debugging port, and the proxy
 * offering the agent the Page Object Tools alone; then the CLI as for the
 * Playwright CLI arm, with its session attached to that browser over CDP.
 * `playwright-cli open` would navigate the adopted tab to its URL again (it
 * runs `goto` once the session is up), a second page load the pairing would
 * have to survive; `attach` takes a snapshot instead and leaves the tab as it
 * is, and the snapshot names the page, which must be the start page.
 */
export async function setUpPlaywrightCliWithAymePageObjects(
  context: ArmContext
): Promise<ArmSetup> {
  const port = await freeLoopbackPort();
  const endpoint = cdpEndpoint(port);
  const environment = playwrightCliEnvironment(context, undefined, {
    cdpEndpoint: endpoint,
  });
  const skillDir = await installCliAndSkill(context);
  const page = await setUpAymePage(context, {
    goalLoop: false,
    pageObjects: true,
    browserArgs: [`--remote-debugging-port=${port}`],
    pageObjectToolsOnly: true,
  });
  let session: { dispose: () => Promise<void> } | undefined;
  const dispose = async () => {
    // The session first: it only attaches, and the browser is the page setup's to close.
    await session?.dispose();
    await page.dispose();
  };
  try {
    session = await startSession(context, environment, [
      "attach",
      `--cdp=${endpoint}`,
    ]);
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    environment,
    readableDirectories: [context.outputDir, skillDir],
    evidence: { ...page.evidence, remoteDebuggingPort: port },
    dispose,
  };
}
