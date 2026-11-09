/**
 * The arms: the browser interfaces the same mission is run through. Every arm
 * shares the prompt, model, timeout and isolated Claude Code configuration;
 * an arm contributes only its interface line, its MCP servers, the built-in
 * tools it leaves the agent, the permission rules that let it use them, and
 * what it needs checked and set up outside the measured window.
 */
import {
  agentBrowserVersion,
  setUpAgentBrowserBaseline,
  setUpAgentBrowserWithAymeWebMcp,
} from "./agentBrowser.ts";
import {
  aymeMcpPackageName,
  aymeMcpPreconditions,
  aymeMcpServer,
  aymeMcpVersion,
  aymeServerName,
  aymeSkillName,
  aymeWebMcpPreconditions,
  setUpAymeAgent,
} from "./ayme.ts";
import type { Mission } from "./missions.ts";
import {
  playwrightCliVersion,
  setUpPlaywrightCli,
  setUpPlaywrightCliWithAymePageObjects,
  setUpPlaywrightCliWithAymeWebMcp,
} from "./playwrightCli.ts";
import {
  playwrightMcpServer,
  playwrightMcpVersion,
  setUpPlaywrightMcpWithAymePageObjects,
  setUpPlaywrightMcpWithAymeWebMcp,
} from "./playwrightMcp.ts";
import type { Precondition } from "./preconditions.ts";

export type ArmId =
  | "playwright-mcp"
  | "playwright-mcp-with-ayme-page-objects"
  | "playwright-mcp-with-ayme-webmcp"
  | "playwright-cli"
  | "playwright-cli-with-ayme-page-objects"
  | "playwright-cli-with-ayme-webmcp"
  | "agent-browser"
  | "agent-browser-with-ayme-webmcp"
  | "ayme-goal-loop-off"
  | "ayme-no-page-objects-goal-loop-off";

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
  /**
   * MCP servers the setup adds to the arm's own, for an interface whose
   * command the setup alone can name, such as one attached to a port chosen then.
   */
  mcpServers?: Record<string, McpServer>;
  /** Undoes the setup after the run, whatever its outcome. */
  dispose: () => Promise<void>;
};

export type Arm = {
  id: ArmId;
  /** The one prompt line that differs between arms; it may say where the browser is. */
  interfaceLine: (start: Mission["start"]) => string;
  /** The interface's skill, which the setup turn names and loads; none for an arm without one. */
  skill?: string;
  /** The setup turn also reads the skill's references, from the folder the arm's setup makes readable. */
  readsSkillReferences?: boolean;
  /** Built-in Claude Code tools the agent keeps. Read-only file tools; the arm's interface does the rest. */
  tools: string[];
  /** Permission rules letting the agent call the arm's interface without a prompt. */
  allowedTools: string[];
  /** Permission rules that stay denied, whatever the interface's own skill allows. */
  disallowedTools?: string[];
  /** The arm's MCP servers; the run adds the ones its setup returns. */
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

/**
 * Every arm gets Claude Code's ToolSearch, as a default install has it. Without it Claude Code
 * turns tool search off and sends every MCP tool in full, so a changed tool list rewrites the
 * cached prompt prefix.
 */
const baseTools = ["Read", "Glob", "Grep", "ToolSearch"];

/** A command with and without arguments, as permission rules. */
function bashCommand(command: string) {
  return [`Bash(${command})`, `Bash(${command}:*)`];
}

/**
 * An Ayme arm: the page's own tools through Ayme's MCP server, paired with
 * the page before the agent starts, and nothing else. The arms differ in
 * the lab app's page objects switch, which the setup sets before the page
 * loads: without page objects the page publishes `snapshot` and the Browser
 * Tools only and the interface line names no Page Object Tools. The Goal
 * Loop arms were removed; the ids keep their `goal-loop-off` suffix so
 * stored results stay comparable by arm name. The server's own tools stay: `ayme_connect` only
 * returns a link, which the agent has no way to open, and the server, busy
 * with its tab, ignores any other tab's scan, so the agent cannot leave the
 * harness's tab.
 */
function aymeArm(id: ArmId, options: { pageObjects: boolean }): Arm {
  const { pageObjects } = options;
  const toolsLine = pageObjects
    ? "`snapshot`, Ayme's Browser Tools and the Page Object Tools of the screen you are on."
    : "`snapshot` and Ayme's Browser Tools. The app has no page objects, so no Page Object Tools are listed.";
  const interfaceLine = `Use the page's own tools through the \`${aymeServerName}\` MCP server, which is already connected to the page, for every browser interaction: ${toolsLine}`;
  return {
    id,
    interfaceLine: () => interfaceLine,
    skill: aymeSkillName,
    readsSkillReferences: true,
    // The skill is loaded through the Skill tool, in the setup turn. Its references are read then
    // too; the setup's readable folder is expected to let Read reach them, without a Read rule.
    tools: [...baseTools, "Skill"],
    allowedTools: [`mcp__${aymeServerName}`, `Skill(${aymeSkillName})`],
    mcpServers: (context) => ({ [aymeServerName]: aymeMcpServer(context) }),
    preconditions: aymeMcpPreconditions,
    setup: (context) => setUpAymeAgent(context, options),
    browserInterface: () => ({
      name: aymeMcpPackageName,
      version: aymeMcpVersion(),
    }),
  };
}

/** The Playwright MCP arm's interface line; the arm with Ayme's Page Object Tools adds one sentence to it. */
const playwrightMcpInterfaceLine =
  "Use the Playwright MCP browser tools (the `playwright` MCP server) for every browser interaction.";

/**
 * What an arm with Ayme's Page Object Tools adds to its browser tool's
 * interface line; the two arms of a pair differ in nothing else the agent
 * reads.
 */
export const pageObjectToolsSentence = `The \`${aymeServerName}\` MCP server offers the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step.`;

/**
 * What an arm with the page's tools through WebMCP adds to its browser
 * tool's interface line instead: Playwright lists the tools the page
 * registered, Ayme's Page Object Tools among them, and nothing names the
 * `ayme` server, which does not run. The Playwright CLI's own skill already
 * says to prefer a page's tools, so this stays one sentence for both arms.
 */
export const webMcpToolsSentence =
  "The page's own tools, which Playwright lists as WebMCP tools, include the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step.";

const playwrightMcpInterface = () => ({
  name: "@playwright/mcp",
  version: playwrightMcpVersion(),
});

const playwrightCliInterfaceLine = (start: Mission["start"]) =>
  `Use the \`playwright-cli\` command for every browser interaction. Its browser session is already open ${start.signedIn ? "and signed in on the editor" : "on the sign-in page, not signed in"}; start from \`playwright-cli snapshot\`.`;

/**
 * The Playwright CLI arm, or one of its twins with Ayme's Page Object Tools:
 * the one with the `ayme` server adds it through the filtered proxy, with
 * its permission and its sentence on the interface line; the one with WebMCP
 * adds its sentence alone, since the CLI itself lists and calls the page's
 * tools. Nothing else differs.
 */
function playwrightCliArm(
  id:
    | "playwright-cli"
    | "playwright-cli-with-ayme-page-objects"
    | "playwright-cli-with-ayme-webmcp"
): Arm {
  const withAyme = id === "playwright-cli-with-ayme-page-objects";
  const withWebMcp = id === "playwright-cli-with-ayme-webmcp";
  const sentence = withAyme
    ? ` ${pageObjectToolsSentence}`
    : withWebMcp
      ? ` ${webMcpToolsSentence}`
      : "";
  return {
    id,
    interfaceLine: (start) => `${playwrightCliInterfaceLine(start)}${sentence}`,
    skill: "playwright-cli",
    // The skill is loaded through the Skill tool, in the setup turn; Bash is only the CLI.
    tools: [...baseTools, "Bash", "Skill"],
    allowedTools: [
      "Bash(playwright-cli:*)",
      "Skill(playwright-cli)",
      ...(withAyme ? [`mcp__${aymeServerName}`] : []),
    ],
    disallowedTools: [
      // The skill pre-approves `npx playwright`, which would run the lab app's own Playwright, or download one.
      "Bash(npx:*)",
      // Downloads a browser.
      ...bashCommand("playwright-cli install"),
      ...bashCommand("playwright-cli install-browser"),
      // Kills every Playwright daemon on the machine, other runs' included.
      ...bashCommand("playwright-cli kill-all"),
    ],
    mcpServers: (context): Record<string, McpServer> =>
      withAyme ? { [aymeServerName]: aymeMcpServer(context) } : {},
    ...(withAyme ? { preconditions: aymeMcpPreconditions } : {}),
    ...(withWebMcp ? { preconditions: aymeWebMcpPreconditions } : {}),
    setup: withAyme
      ? setUpPlaywrightCliWithAymePageObjects
      : withWebMcp
        ? setUpPlaywrightCliWithAymeWebMcp
        : setUpPlaywrightCli,
    browserInterface: () => ({
      name: "@playwright/cli",
      version: playwrightCliVersion(),
    }),
  };
}

const agentBrowserInterfaceLine = (start: Mission["start"]) =>
  `Use the \`agent-browser\` command for every browser interaction. Its browser session is already open ${start.signedIn ? "and signed in on the editor" : "on the sign-in page, not signed in"}; start from \`agent-browser snapshot\`.`;

/**
 * What the agent-browser arm with the page's tools through WebMCP adds to
 * its interface line: `webMcpToolsSentence` with agent-browser's commands in
 * place of Playwright. Attached over CDP to a page that registered its tools
 * before the session started, agent-browser announces none of them in its
 * output, so the sentence names the command that lists them.
 */
export const agentBrowserWebMcpToolsSentence =
  "The page's own tools, which `agent-browser webmcp list` lists and `agent-browser webmcp invoke` calls, include the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step.";

/**
 * An agent-browser arm: the Playwright CLI arm's counterpart with Vercel's
 * `agent-browser` CLI. Its session is attached over CDP to the browser the
 * setup launched on the start page, as the CLI's WebMCP twin's is, since
 * agent-browser must not launch or download a browser of its own. The
 * baseline keeps agent-browser's WebMCP support off and denies its `webmcp`
 * commands, which would otherwise still reach the lab app's own Ayme tools;
 * the twin turns it on and adds its one sentence. Nothing else differs.
 */
function agentBrowserArm(
  id: "agent-browser" | "agent-browser-with-ayme-webmcp"
): Arm {
  const withWebMcp = id === "agent-browser-with-ayme-webmcp";
  return {
    id,
    interfaceLine: (start) =>
      withWebMcp
        ? `${agentBrowserInterfaceLine(start)} ${agentBrowserWebMcpToolsSentence}`
        : agentBrowserInterfaceLine(start),
    skill: "agent-browser",
    // The skill is loaded through the Skill tool, in the setup turn; Bash is only the CLI.
    tools: [...baseTools, "Bash", "Skill"],
    allowedTools: ["Bash(agent-browser:*)", "Skill(agent-browser)"],
    disallowedTools: [
      // The skill's guide pre-approves `npx agent-browser`, which could fetch another version.
      "Bash(npx:*)",
      // Downloads a browser, or a newer agent-browser.
      ...bashCommand("agent-browser install"),
      ...bashCommand("agent-browser upgrade"),
      // Reinstalls the browser and purges state.
      ...bashCommand("agent-browser doctor --fix"),
      // Closes every session, not only the run's.
      ...bashCommand("agent-browser close --all"),
      ...(withWebMcp ? [] : bashCommand("agent-browser webmcp")),
    ],
    mcpServers: () => ({}),
    preconditions: aymeWebMcpPreconditions,
    setup: withWebMcp
      ? setUpAgentBrowserWithAymeWebMcp
      : setUpAgentBrowserBaseline,
    browserInterface: () => ({
      name: "agent-browser",
      version: agentBrowserVersion(),
    }),
  };
}

export const arms: Record<ArmId, Arm> = {
  "playwright-mcp": {
    id: "playwright-mcp",
    interfaceLine: () => playwrightMcpInterfaceLine,
    tools: baseTools,
    allowedTools: ["mcp__playwright"],
    mcpServers: (context) => ({ playwright: playwrightMcpServer(context) }),
    browserInterface: playwrightMcpInterface,
  },
  /**
   * The Playwright MCP arm with Ayme's Page Object Tools beside it, so a
   * browser tool is compared with and without Ayme. Playwright MCP drives the
   * page that paired with the run's `ayme mcp`, attached over CDP to the
   * browser the setup launched, and the `ayme` server reaches the agent
   * through a proxy that offers the page's Page Object Tools alone: none of
   * the server's own tools, no Browser Tool, no `snapshot`. Page objects on,
   * Goal Loop off, no skill. The Playwright MCP entry is the setup's, since it
   * names the port chosen then.
   */
  "playwright-mcp-with-ayme-page-objects": {
    id: "playwright-mcp-with-ayme-page-objects",
    interfaceLine: () =>
      `${playwrightMcpInterfaceLine} ${pageObjectToolsSentence}`,
    tools: baseTools,
    allowedTools: ["mcp__playwright", `mcp__${aymeServerName}`],
    mcpServers: (context) => ({ [aymeServerName]: aymeMcpServer(context) }),
    preconditions: aymeMcpPreconditions,
    setup: setUpPlaywrightMcpWithAymePageObjects,
    browserInterface: playwrightMcpInterface,
  },
  /**
   * The Playwright MCP arm with Ayme's Page Object Tools through WebMCP as
   * Playwright MCP itself surfaces it: the server attaches over CDP to a
   * browser with the WebMCP flag, collects the tools the page registered
   * with each snapshot and lists each as a `webmcp_<name>` tool of its own,
   * so the agent gets `snapshot`, the Browser Tools and the Page Object
   * Tools as the page publishes them today, and no `ayme` server runs. Page
   * objects on, Goal Loop off, no skill. The Playwright MCP entry is the
   * setup's, since it names the port chosen then; the arm has no server of
   * its own.
   */
  "playwright-mcp-with-ayme-webmcp": {
    id: "playwright-mcp-with-ayme-webmcp",
    interfaceLine: () => `${playwrightMcpInterfaceLine} ${webMcpToolsSentence}`,
    tools: baseTools,
    allowedTools: ["mcp__playwright"],
    mcpServers: () => ({}),
    preconditions: aymeWebMcpPreconditions,
    setup: setUpPlaywrightMcpWithAymeWebMcp,
    browserInterface: playwrightMcpInterface,
  },
  "playwright-cli": playwrightCliArm("playwright-cli"),
  /**
   * The Playwright CLI arm with Ayme's Page Object Tools beside it, the CLI's
   * twin of `playwright-mcp-with-ayme-page-objects`: the CLI session is
   * attached over CDP to the browser the setup paired with the run's `ayme
   * mcp`, and the `ayme` server reaches the agent through the proxy that
   * offers the Page Object Tools alone. Page objects on, Goal Loop off; the
   * CLI's skill as for its arm.
   */
  "playwright-cli-with-ayme-page-objects": playwrightCliArm(
    "playwright-cli-with-ayme-page-objects"
  ),
  /**
   * The CLI's twin of `playwright-mcp-with-ayme-webmcp`: the CLI session is
   * attached over CDP to a browser with the WebMCP flag and no Ayme server,
   * with the CLI's handling of page tools on, so the page status counts
   * them, the snapshot lists them and `webmcp-list` and `webmcp-call` reach
   * them. Page objects on, Goal Loop off; the CLI's skill as for its arm.
   */
  "playwright-cli-with-ayme-webmcp": playwrightCliArm(
    "playwright-cli-with-ayme-webmcp"
  ),
  /**
   * The baseline for agent-browser, the Playwright CLI arm's counterpart:
   * the `agent-browser` command and its skill, attached to the harness's
   * browser, with its WebMCP support off. Page objects as for the Playwright
   * CLI arm, Goal Loop off.
   */
  "agent-browser": agentBrowserArm("agent-browser"),
  /**
   * The agent-browser twin of `playwright-cli-with-ayme-webmcp`: the same
   * command and skill with agent-browser's WebMCP support on, so `webmcp
   * list` and `webmcp invoke` reach the tools the page registered. No Ayme
   * server, nothing paired, page objects on, Goal Loop off.
   */
  "agent-browser-with-ayme-webmcp": agentBrowserArm(
    "agent-browser-with-ayme-webmcp"
  ),
  "ayme-goal-loop-off": aymeArm("ayme-goal-loop-off", { pageObjects: true }),
  "ayme-no-page-objects-goal-loop-off": aymeArm(
    "ayme-no-page-objects-goal-loop-off",
    { pageObjects: false }
  ),
};

export const armIds = Object.keys(arms) as ArmId[];

export function isArmId(value: string): value is ArmId {
  return Object.hasOwn(arms, value);
}
