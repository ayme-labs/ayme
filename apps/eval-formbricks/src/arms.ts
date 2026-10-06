/**
 * The arms: the browser interfaces the same mission is run through. Every arm
 * shares the prompt, model, timeout and isolated Claude Code configuration;
 * an arm contributes only its interface line, its MCP servers, the built-in
 * tools it leaves the agent, the permission rules that let it use them, and
 * what it needs checked and set up outside the measured window.
 */
import { createRequire } from "node:module";
import path from "node:path";

import {
  aymeMcpPackageName,
  aymeMcpPreconditions,
  aymeMcpServer,
  aymeMcpVersion,
  aymeServerName,
  aymeSkillName,
  setUpAymeAgent,
} from "./ayme.ts";
import type { Mission } from "./missions.ts";
import { playwrightCliVersion, setUpPlaywrightCli } from "./playwrightCli.ts";
import type { Precondition } from "./preconditions.ts";

export type ArmId =
  | "playwright-mcp"
  | "playwright-cli"
  | "ayme-goal-loop-off"
  | "ayme-goal-loop-on";

export type McpServer = { command: string; args: string[] };

/** Per-run paths an arm may point its interface at. */
export type ArmContext = {
  runId: string;
  runDir: string;
  /** The browser profile the harness prepared: signed in for a mission that starts on the editor, fresh otherwise. */
  profileDir: string;
  /** Where the interface writes files it names itself, such as screenshots. */
  outputDir: string;
  /** A script the browser runs on each new page; opens the mission's start URL. */
  initPagePath: string;
  /** The run's fresh Claude Code configuration folder. */
  configDir: string;
  /** Where the agent starts, and whether the browser is signed in there. */
  start: Mission["start"];
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
  /** What the setup established before the measured window, recorded in the result. */
  evidence?: Record<string, unknown>;
  /** Undoes the setup after the run, whatever its outcome. */
  dispose: () => Promise<void>;
};

export type Arm = {
  id: ArmId;
  /** The one prompt line that differs between arms; it may say where the browser is. */
  interfaceLine: (start: Mission["start"]) => string;
  /** Built-in Claude Code tools the agent keeps. Read-only file tools; the arm's interface does the rest. */
  tools: string[];
  /** Permission rules letting the agent call the arm's interface without a prompt. */
  allowedTools: string[];
  /** Permission rules that stay denied, whatever the interface's own skill allows. */
  disallowedTools?: string[];
  mcpServers: (context: ArmContext) => Record<string, McpServer>;
  /** What the interface needs before a run starts, checked with the shared preconditions. */
  preconditions?: Precondition[];
  /**
   * Runs once, after the harness has opened the start page and before the measured window:
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
  return [`Bash(${command})`, `Bash(${command}:*)`];
}

/**
 * The "on" arm's interface line adds this sentence to the "off" arm's; the
 * two arms differ in nothing else the agent reads.
 */
export const goalFirstSentence =
  "Hand the goal to the `goal` tool first; use the other tools only if it can't finish.";

/**
 * An Ayme arm: the page's own tools through Ayme's MCP server, paired with
 * the page before the agent starts, and nothing else. The two arms differ in
 * the lab app's Goal Loop switch, which the setup sets before the page loads,
 * and in the goal-first sentence of the prompt's interface line. The server's
 * own tools stay: `ayme_connect` only returns a link, which the agent has no
 * way to open, and the server, busy with its tab, ignores any other tab's
 * scan, so the agent cannot leave the harness's tab.
 */
function aymeArm(id: ArmId, goalLoop: boolean): Arm {
  const interfaceLine = `Use the page's own tools through the \`${aymeServerName}\` MCP server, which is already connected to the page, and its \`${aymeSkillName}\` skill for every browser interaction: \`snapshot\`, Ayme's Browser Tools and the Page Object Tools of the screen you are on.`;
  return {
    id,
    interfaceLine: () =>
      goalLoop ? `${interfaceLine} ${goalFirstSentence}` : interfaceLine,
    // The skill is invoked through the Skill tool.
    tools: [...readOnlyFileTools, "Skill"],
    allowedTools: [`mcp__${aymeServerName}`, `Skill(${aymeSkillName})`],
    mcpServers: (context) => ({ [aymeServerName]: aymeMcpServer(context) }),
    preconditions: aymeMcpPreconditions,
    setup: (context) => setUpAymeAgent(context, { goalLoop }),
    browserInterface: () => ({
      name: aymeMcpPackageName,
      version: aymeMcpVersion(),
    }),
  };
}

export const arms: Record<ArmId, Arm> = {
  "playwright-mcp": {
    id: "playwright-mcp",
    interfaceLine: () =>
      "Use the Playwright MCP browser tools (the `playwright` MCP server) for every browser interaction.",
    tools: readOnlyFileTools,
    allowedTools: ["mcp__playwright"],
    mcpServers: ({ profileDir, outputDir, initPagePath }) => ({
      playwright: {
        command: process.execPath,
        args: [
          path.join(playwrightMcpRoot, "cli.js"),
          // The system Chrome, Playwright MCP's default; the harness prepares the profile with the same browser.
          "--browser",
          "chrome",
          "--headless",
          // The lab app publishes Ayme's tools through WebMCP; this arm gets Playwright MCP's own tools only.
          "--no-webmcp",
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
    interfaceLine: (start) =>
      `Use the \`playwright-cli\` command and its \`playwright-cli\` skill for every browser interaction. Its browser session is already open ${start.signedIn ? "and signed in on the editor" : "on the sign-in page, not signed in"}; start from \`playwright-cli snapshot\`.`,
    // The skill is invoked through the Skill tool; Bash is only the CLI.
    tools: [...readOnlyFileTools, "Bash", "Skill"],
    allowedTools: ["Bash(playwright-cli:*)", "Skill(playwright-cli)"],
    disallowedTools: [
      // The skill pre-approves `npx playwright`, which would run the lab app's own Playwright, or download one.
      "Bash(npx:*)",
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
  "ayme-goal-loop-off": aymeArm("ayme-goal-loop-off", false),
  "ayme-goal-loop-on": aymeArm("ayme-goal-loop-on", true),
};

export const armIds = Object.keys(arms) as ArmId[];

export function isArmId(value: string): value is ArmId {
  return Object.hasOwn(arms, value);
}
