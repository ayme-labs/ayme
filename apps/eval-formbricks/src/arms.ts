/**
 * The arms: the browser interfaces the same mission is run through. Every arm
 * shares the prompt, model, timeout and isolated Claude Code configuration;
 * an arm contributes only its interface line, its MCP servers, the built-in
 * tools it leaves the agent and the permission rules that let it use them.
 */
import { createRequire } from "node:module";
import path from "node:path";

import { playwrightCliVersion, setUpPlaywrightCli } from "./playwrightCli.ts";

export type ArmId = "playwright-mcp" | "playwright-cli";

export type McpServer = { command: string; args: string[] };

/** Per-run paths an arm may point its interface at. */
export type ArmContext = {
  runId: string;
  runDir: string;
  /** The browser profile the harness signed in to. */
  profileDir: string;
  /** Where the interface writes files it names itself, such as screenshots. */
  outputDir: string;
  /** A script the browser runs on each new page; opens the mission's start URL. */
  initPagePath: string;
  /** The run's fresh Claude Code configuration folder. */
  configDir: string;
  /** The mission's start URL: the survey editor. */
  startUrl: string;
  /** The agent's working root. */
  cwd: string;
  log: (line: string) => void;
};

/** What an arm's setup hands the run. */
export type ArmSetup = {
  /** Added to the agent's environment. */
  environment: Record<string, string>;
  /** Folders outside the working root the agent may read, such as the interface's output. */
  readableDirectories: string[];
  /** Undoes the setup after the run, whatever its outcome. */
  dispose: () => Promise<void>;
};

export type Arm = {
  id: ArmId;
  /** The one prompt line that differs between arms. */
  interfaceLine: string;
  /** Built-in Claude Code tools the agent keeps. Read-only file tools; the arm's interface does the rest. */
  tools: string[];
  /** Permission rules letting the agent call the arm's interface without a prompt. */
  allowedTools: string[];
  /** Permission rules that stay denied, whatever the interface's own skill allows. */
  disallowedTools?: string[];
  mcpServers: (context: ArmContext) => Record<string, McpServer>;
  /**
   * Runs once, after the harness has signed in and before the measured window:
   * installs or materialises what the interface needs outside it.
   */
  setup?: (context: ArmContext) => Promise<ArmSetup>;
  /** The pinned interface and its version, recorded in every result. */
  browserInterface: () => { name: string; version: string };
};

const require = createRequire(import.meta.url);
const playwrightMcpPackagePath =
  require.resolve("@playwright/mcp/package.json");
export const playwrightMcpRoot = path.dirname(playwrightMcpPackagePath);

function playwrightMcpVersion(): string {
  const manifest = require(playwrightMcpPackagePath) as { version: string };
  return manifest.version;
}

const readOnlyFileTools = ["Read", "Glob", "Grep"];

/** A command with and without arguments, as permission rules. */
function bashCommand(command: string) {
  return [`Bash(${command})`, `Bash(${command} *)`];
}

export const arms: Record<ArmId, Arm> = {
  "playwright-mcp": {
    id: "playwright-mcp",
    interfaceLine:
      "Use the Playwright MCP browser tools (the `playwright` MCP server) for every browser interaction.",
    tools: readOnlyFileTools,
    allowedTools: ["mcp__playwright"],
    mcpServers: ({ profileDir, outputDir, initPagePath }) => ({
      playwright: {
        command: process.execPath,
        args: [
          path.join(playwrightMcpRoot, "cli.js"),
          // The system Chrome, Playwright MCP's default; the harness signs in with the same browser.
          "--browser",
          "chrome",
          "--headless",
          "--user-data-dir",
          profileDir,
          "--output-dir",
          outputDir,
          "--init-page",
          initPagePath,
        ],
      },
    }),
    browserInterface: () => ({
      name: "@playwright/mcp",
      version: playwrightMcpVersion(),
    }),
  },
  "playwright-cli": {
    id: "playwright-cli",
    interfaceLine:
      "Use the `playwright-cli` command and its `playwright-cli` skill for every browser interaction. Its browser session is already open and signed in on the editor; start from `playwright-cli snapshot`.",
    // The skill is invoked through the Skill tool; Bash is only the CLI.
    tools: [...readOnlyFileTools, "Bash", "Skill"],
    allowedTools: ["Bash(playwright-cli *)", "Skill(playwright-cli)"],
    disallowedTools: [
      // The skill pre-approves `npx playwright`, which would run the lab app's own Playwright, or download one.
      "Bash(npx *)",
      // Downloads a browser.
      ...bashCommand("playwright-cli install"),
      ...bashCommand("playwright-cli install-browser"),
      // Kills every Playwright daemon on the machine, other runs' included.
      ...bashCommand("playwright-cli kill-all"),
    ],
    mcpServers: () => ({}),
    setup: setUpPlaywrightCli,
    browserInterface: () => ({
      name: "@playwright/cli",
      version: playwrightCliVersion(),
    }),
  },
};

export const armIds = Object.keys(arms) as ArmId[];

export function isArmId(value: string): value is ArmId {
  return value in arms;
}
