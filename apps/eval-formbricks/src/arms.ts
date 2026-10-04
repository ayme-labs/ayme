/**
 * The arms: the browser interfaces the same mission is run through. Every arm
 * shares the prompt, model, timeout and isolated Claude Code configuration;
 * an arm contributes only its interface line, its MCP servers, the built-in
 * tools it leaves the agent and the permission rules that let it use them.
 */
import { createRequire } from "node:module";
import path from "node:path";

export type ArmId = "playwright-mcp";

export type McpServer = { command: string; args: string[] };

/** Per-run paths an arm may point its interface at. */
export type ArmContext = {
  /** The browser profile the harness signed in to. */
  profileDir: string;
  /** Where the interface writes files it names itself, such as screenshots. */
  outputDir: string;
  /** A script the browser runs on each new page; opens the mission's start URL. */
  initPagePath: string;
};

export type Arm = {
  id: ArmId;
  /** The one prompt line that differs between arms. */
  interfaceLine: string;
  /** Built-in Claude Code tools the agent keeps. Read-only file tools; the arm's interface does the rest. */
  tools: string[];
  /** Permission rules letting the agent call the arm's interface without a prompt. */
  allowedTools: string[];
  mcpServers: (context: ArmContext) => Record<string, McpServer>;
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
};

export const armIds = Object.keys(arms) as ArmId[];

export function isArmId(value: string): value is ArmId {
  return value in arms;
}
