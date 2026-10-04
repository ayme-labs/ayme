/**
 * Everything the Playwright CLI arm sets up before the measured window: the
 * `playwright-cli` command on the agent's PATH, the CLI's official skill in the
 * run's Claude Code configuration folder, and a browser session already open,
 * signed in, on the survey editor. The measured agent installs and downloads
 * nothing.
 */
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { ArmContext, ArmSetup } from "./arms.ts";
import { withoutClaudeVariables } from "./claude.ts";

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
 * after the run, so the plain command reaches it. The profile is the signed-in
 * one, even if the agent restarts the browser. The page's WebMCP tools stay
 * off: the lab app registers Ayme's, and this arm is the CLI alone.
 */
export function playwrightCliEnvironment(
  context: Pick<ArmContext, "runId" | "runDir" | "profileDir" | "outputDir">,
  parentPath: string = process.env.PATH ?? ""
): Record<string, string> {
  return {
    // No update check on the network, no download.
    NO_UPDATE_NOTIFIER: "1",
    PATH: `${shimDirectory(context.runDir)}${path.delimiter}${parentPath}`,
    PLAYWRIGHT_CLI_SESSION: context.runId,
    // The system Chrome, like the other arms. Its Playwright is the one that signed in, from the same pinned build.
    PLAYWRIGHT_MCP_BROWSER: "chrome",
    PLAYWRIGHT_MCP_USER_DATA_DIR: context.profileDir,
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

export async function setUpPlaywrightCli(
  context: ArmContext
): Promise<ArmSetup> {
  const environment = playwrightCliEnvironment(context);

  await mkdir(shimDirectory(context.runDir), { recursive: true });
  const shim = path.join(shimDirectory(context.runDir), "playwright-cli");
  await writeFile(shim, shimScript());
  await chmod(shim, 0o755);

  // The skill is read from the fresh configuration folder; only this arm's run has one.
  const skillDir = skillDirectory(context.configDir);
  await cp(skillSource, skillDir, { recursive: true });

  const dispose = async () => {
    try {
      await runCli(context, environment, ["close"]);
    } catch (error) {
      context.log(
        `Closing the Playwright CLI session failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  context.log(`Opening the Playwright CLI session "${context.runId}".`);
  try {
    const output = await runCli(context, environment, [
      "open",
      context.startUrl,
    ]);
    const pageUrl = parsePageUrl(output);
    if (
      pageUrl === null ||
      new URL(pageUrl).pathname !== new URL(context.startUrl).pathname
    )
      throw new Error(
        `The Playwright CLI opened ${pageUrl ?? "no page"} instead of the editor at ${context.startUrl}.`
      );
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    environment,
    readableDirectories: [context.outputDir, skillDir],
    dispose,
  };
}
