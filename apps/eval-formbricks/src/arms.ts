/**
 * The arms: the browser interfaces the same mission is run through. Every arm
 * shares the prompt, model, timeout and isolated Claude Code configuration;
 * an arm contributes only its interface line, its MCP servers, the built-in
 * tools it leaves the agent, the permission rules that let it use them, and
 * what it needs checked and set up outside the measured window.
 *
 * Each browser automation, Playwright MCP, Playwright CLI and agent-browser,
 * has three arms: the browser automation alone, on Formbricks as it is; with
 * Ayme through WebMCP, which the browser automation itself reads from the
 * page; and with Ayme as its own MCP server, `ayme`, beside it. Both arms
 * with Ayme serve the lab app's Page Objects with the run's `ayme mcp`,
 * started as the `ayme` skill's reference on browser automation tools says,
 * and load that skill and that reference in the setup turn. The interface
 * line states which tools the agent has, and no instruction of Ayme's: those
 * come from the reference. The arms alone get nothing of Ayme.
 */
import {
  agentBrowserVersion,
  setUpAgentBrowserAlone,
  setUpAgentBrowserWithAyme,
} from "./agentBrowser.ts";
import {
  aymeMcpServer,
  aymePreconditions,
  aymeServerName,
  aymeSkillName,
  type AymeChannel,
} from "./ayme.ts";
import type { Mission } from "./missions.ts";
import {
  playwrightCliVersion,
  setUpPlaywrightCli,
  setUpPlaywrightCliWithAyme,
} from "./playwrightCli.ts";
import {
  playwrightMcpServer,
  playwrightMcpVersion,
  setUpPlaywrightMcpWithAyme,
} from "./playwrightMcp.ts";
import type { Precondition } from "./preconditions.ts";

export type BrowserAutomation =
  "playwright-mcp" | "playwright-cli" | "agent-browser";

export type ArmId =
  | BrowserAutomation
  | `${BrowserAutomation}-with-ayme-page-objects`
  | `${BrowserAutomation}-with-ayme-webmcp`;

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
  /** The agent's working root, where its interface's commands run too. */
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
  /** MCP servers the setup adds to the arm's own, such as one attached to a port chosen then. */
  mcpServers?: Record<string, McpServer>;
  /** Undoes the setup after the run, whatever its outcome. */
  dispose: () => Promise<void>;
};

export type Arm = {
  id: ArmId;
  browserAutomation: BrowserAutomation;
  /** How Ayme's Page Object Tools reach the agent; none for an arm without Ayme. */
  ayme?: AymeChannel;
  /** The one prompt line that differs between arms; it may say where the browser is. */
  interfaceLine: (start: Mission["start"]) => string;
  /** The browser automation's own skill, which the setup turn names and loads; none for an arm without one. */
  skill?: string;
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

function startState(start: Mission["start"]) {
  return start.signedIn
    ? "and signed in on the editor"
    : "on the sign-in page, not signed in";
}

/** Each browser automation's interface line when it runs alone. */
const aloneLines: Record<
  BrowserAutomation,
  (start: Mission["start"]) => string
> = {
  "playwright-mcp": () =>
    "Use the Playwright MCP browser tools (the `playwright` MCP server) for every browser interaction.",
  "playwright-cli": (start) =>
    `Use the \`playwright-cli\` command for every browser interaction. Its browser session is already open ${startState(start)}; start from \`playwright-cli snapshot\`.`,
  "agent-browser": (start) =>
    `Use the \`agent-browser\` command for every browser interaction. Its browser session is already open ${startState(start)}; start from \`agent-browser snapshot\`.`,
};

/**
 * What an arm with Ayme adds to its browser automation's line: where the
 * Page Object Tools are, as a fact. Nothing on when to call them or what to
 * read after one: that is the skill reference's.
 */
export function aymeToolsSentence(
  browserAutomation: BrowserAutomation,
  channel: AymeChannel
): string {
  if (channel === "mcp")
    return `The \`${aymeServerName}\` MCP server lists the Page Object Tools of the screen the browser is on.`;
  const lists = {
    "playwright-mcp": "which Playwright MCP lists as WebMCP tools",
    "playwright-cli": "which `playwright-cli webmcp-list` lists",
    "agent-browser": "which `agent-browser webmcp list` lists",
  }[browserAutomation];
  return `The page's own tools, ${lists}, include the Page Object Tools of the screen the browser is on.`;
}

/** What each browser automation runs on and is set up with; an arm with Ayme adds to it. */
const browserAutomations: Record<
  BrowserAutomation,
  Pick<Arm, "skill" | "tools" | "allowedTools" | "browserInterface"> & {
    disallowedTools: (channel: AymeChannel | null) => string[];
  }
> = {
  "playwright-mcp": {
    tools: baseTools,
    allowedTools: ["mcp__playwright"],
    disallowedTools: () => [],
    browserInterface: () => ({
      name: "@playwright/mcp",
      version: playwrightMcpVersion(),
    }),
  },
  "playwright-cli": {
    skill: "playwright-cli",
    // The skill is loaded through the Skill tool, in the setup turn; Bash is only the CLI.
    tools: [...baseTools, "Bash", "Skill"],
    allowedTools: ["Bash(playwright-cli:*)", "Skill(playwright-cli)"],
    disallowedTools: () => [
      // The skill pre-approves `npx playwright`, which would run the lab app's own Playwright, or download one.
      "Bash(npx:*)",
      // Downloads a browser.
      ...bashCommand("playwright-cli install"),
      ...bashCommand("playwright-cli install-browser"),
      // Kills every Playwright daemon on the machine, other runs' included.
      ...bashCommand("playwright-cli kill-all"),
    ],
    browserInterface: () => ({
      name: "@playwright/cli",
      version: playwrightCliVersion(),
    }),
  },
  "agent-browser": {
    skill: "agent-browser",
    tools: [...baseTools, "Bash", "Skill"],
    allowedTools: ["Bash(agent-browser:*)", "Skill(agent-browser)"],
    disallowedTools: (channel) => [
      // The skill's guide pre-approves `npx agent-browser`, which could fetch another version.
      "Bash(npx:*)",
      // Downloads a browser, or a newer agent-browser.
      ...bashCommand("agent-browser install"),
      ...bashCommand("agent-browser upgrade"),
      // Reinstalls the browser and purges state.
      ...bashCommand("agent-browser doctor --fix"),
      // Closes every session, not only the run's.
      ...bashCommand("agent-browser close --all"),
      // The page's tools reach the agent through WebMCP only in the arm that uses that channel.
      ...(channel === "webmcp" ? [] : bashCommand("agent-browser webmcp")),
    ],
    browserInterface: () => ({
      name: "agent-browser",
      version: agentBrowserVersion(),
    }),
  },
};

/** The arm of a browser automation alone. */
function armAlone(browserAutomation: BrowserAutomation): Arm {
  const base = browserAutomations[browserAutomation];
  const setup = {
    "playwright-mcp": undefined,
    "playwright-cli": setUpPlaywrightCli,
    "agent-browser": setUpAgentBrowserAlone,
  }[browserAutomation];
  return {
    id: browserAutomation,
    browserAutomation,
    interfaceLine: aloneLines[browserAutomation],
    ...(base.skill === undefined ? {} : { skill: base.skill }),
    tools: base.tools,
    allowedTools: base.allowedTools,
    disallowedTools: base.disallowedTools(null),
    mcpServers: (context): Record<string, McpServer> =>
      browserAutomation === "playwright-mcp"
        ? { playwright: playwrightMcpServer(context) }
        : {},
    ...(setup === undefined ? {} : { setup }),
    browserInterface: base.browserInterface,
  };
}

/**
 * The arm of a browser automation with Ayme through `channel`: the arm
 * alone, its browser attached over CDP to the page the run's `ayme mcp`
 * serves, plus the `ayme` skill and, for the `mcp` channel, the `ayme`
 * server with its permission.
 */
function armWithAyme(
  browserAutomation: BrowserAutomation,
  channel: AymeChannel
): Arm {
  const base = browserAutomations[browserAutomation];
  const setup = {
    "playwright-mcp": setUpPlaywrightMcpWithAyme,
    "playwright-cli": setUpPlaywrightCliWithAyme,
    "agent-browser": setUpAgentBrowserWithAyme,
  }[browserAutomation];
  return {
    id: `${browserAutomation}-with-ayme-${channel === "mcp" ? "page-objects" : "webmcp"}` as ArmId,
    browserAutomation,
    ayme: channel,
    interfaceLine: (start) =>
      `${aloneLines[browserAutomation](start)} ${aymeToolsSentence(browserAutomation, channel)}`,
    ...(base.skill === undefined ? {} : { skill: base.skill }),
    tools: base.tools.includes("Skill") ? base.tools : [...base.tools, "Skill"],
    allowedTools: [
      ...base.allowedTools,
      `Skill(${aymeSkillName})`,
      ...(channel === "mcp" ? [`mcp__${aymeServerName}`] : []),
    ],
    disallowedTools: base.disallowedTools(channel),
    // The browser automation's own server, where it has one, is the setup's: it names the port chosen then.
    mcpServers: (context): Record<string, McpServer> =>
      channel === "mcp" ? { [aymeServerName]: aymeMcpServer(context) } : {},
    preconditions: aymePreconditions[channel],
    setup: (context) => setup(context, channel),
    browserInterface: base.browserInterface,
  };
}

export const arms: Record<ArmId, Arm> = {
  "playwright-mcp": armAlone("playwright-mcp"),
  "playwright-mcp-with-ayme-webmcp": armWithAyme("playwright-mcp", "webmcp"),
  "playwright-mcp-with-ayme-page-objects": armWithAyme("playwright-mcp", "mcp"),
  "playwright-cli": armAlone("playwright-cli"),
  "playwright-cli-with-ayme-webmcp": armWithAyme("playwright-cli", "webmcp"),
  "playwright-cli-with-ayme-page-objects": armWithAyme("playwright-cli", "mcp"),
  "agent-browser": armAlone("agent-browser"),
  "agent-browser-with-ayme-webmcp": armWithAyme("agent-browser", "webmcp"),
  "agent-browser-with-ayme-page-objects": armWithAyme("agent-browser", "mcp"),
};

export const armIds = Object.keys(arms) as ArmId[];

export function isArmId(value: string): value is ArmId {
  return Object.hasOwn(arms, value);
}
