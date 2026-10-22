import type { AgentConnectionStatus } from "@ayme-dev/ayme/internal";

/** The WebMCP publication status, as the runtime reports it. */
export type PublicationStatus = Readonly<{
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
}>;

/** The Agent Connection status, as the runtime reports it. */
export type { AgentConnectionStatus };

/** Why the Agent Connection is on and the tab is not connected. */
export type NotConnectedReason = NonNullable<
  Extract<AgentConnectionStatus, { state: "not-connected" }>["reason"]
>;

/**
 * How a path's dot reads: `off` hollow grey, `waiting` hollow amber, `ok`
 * green, `warning` amber, `error` red.
 */
export type Tone = "off" | "waiting" | "ok" | "warning" | "error";

/** One path's row in the Connections popover. */
export type ConnectionRow = Readonly<{
  tone: Tone;
  /** Its state in a word or two, beside its name. */
  label: string;
  /** What that state means, or why it is so. */
  lines: readonly string[];
  /** The option that turns it on, when it is off. */
  snippet?: string;
}>;

/**
 * The names of MCP clients we know for sure, as each sends it when it
 * starts the server. Any other name shows as sent.
 */
const AGENT_NAMES: ReadonlyMap<string, string> = new Map([
  ["claude-code", "Claude Code"],
  ["codex-mcp-client", "Codex"],
  ["cursor-vscode", "Cursor"],
]);

/** The agent's name to show, from the one its MCP client sent, if any. */
export function agentName(sent: string | undefined): string | undefined {
  return sent && (AGENT_NAMES.get(sent) ?? sent);
}

const FIX =
  "Ask your agent to call ayme_connect and open the link it gives you.";

const REASONS: Record<NotConnectedReason, string> = {
  connecting: "Connecting to your agent's ayme MCP server.",
  reconnecting:
    "Lost the ayme MCP server this tab was connected to. Trying again.",
  "no-answer": "The ayme MCP server this tab connected to stopped answering.",
  "no-server": "No ayme MCP server answered on the ports ayme looks at.",
  "several-servers":
    "More than one ayme MCP server is running, so this tab won't guess which one.",
  "other-tab": "Your agent is working in another tab.",
  "not-local":
    "This page isn't on localhost, so it doesn't look for a server by itself.",
  "no-client":
    "This page couldn't load @ayme-dev/mcp, which connects it to your agent. The browser console has the error.",
};

// Reasons that asking the agent to call ayme_connect would not fix.
const NO_FIX: ReadonlySet<NotConnectedReason> = new Set([
  "connecting",
  "reconnecting",
  "no-client",
]);

/** The Agent Connection's row. */
export function agentRow(status: AgentConnectionStatus): ConnectionRow {
  switch (status.state) {
    case "off":
      return {
        tone: "off",
        label: "Off",
        lines: [
          "Lets a coding agent such as Claude Code or Cursor call this page's tools.",
        ],
        snippet: "agentConnection: true",
      };
    case "not-connected": {
      const { reason } = status;
      return {
        tone: "waiting",
        label: reason === "reconnecting" ? "Reconnecting" : "Not connected",
        lines:
          reason === undefined
            ? [FIX]
            : NO_FIX.has(reason)
              ? [REASONS[reason]]
              : [REASONS[reason], FIX],
      };
    }
    case "connected":
      return {
        tone: "ok",
        label: "Connected",
        lines: [
          `${agentName(status.agent) ?? "An agent"} is connected to this tab through ayme mcp.`,
        ],
      };
  }
}

/**
 * How many of the session's tools WebMCP publishes: every one but a Peek
 * Tool and `screenshot`, as `@ayme-dev/webmcp` decides.
 */
export function webMcpToolCount(
  tools: readonly Readonly<{ name: string; group?: string }>[]
): number {
  return tools.filter(
    (tool) => tool.group !== "peek" && tool.name !== "screenshot"
  ).length;
}

/** WebMCP's row; `tools` is how many tools it publishes. */
export function webMcpRow(
  status: PublicationStatus,
  tools: number
): ConnectionRow {
  switch (status.state) {
    case "disabled":
      return {
        tone: "off",
        label: "Off",
        lines: ["For agents that live in this browser, such as an extension."],
        snippet: "webMCP: { enabled: true }",
      };
    case "waiting":
      return {
        tone: "ok",
        label: "On",
        lines: ["Publishing to agents in this browser once WebMCP is ready."],
      };
    case "active":
      return {
        tone: "ok",
        label: "Published",
        lines: [
          `${tools} ${tools === 1 ? "tool" : "tools"} published to agents in this browser.`,
        ],
      };
    case "unavailable":
      return {
        tone: "warning",
        label: "Unavailable",
        lines: [
          "This browser has no WebMCP. Load the WebMCP polyfill, or turn on the browser's WebMCP flag.",
        ],
      };
    case "failed":
      return { tone: "error", label: "Failed", lines: [status.message] };
    case "disposed":
      return {
        tone: "off",
        label: "Stopped",
        lines: ["No Ayme runtime session is running, so nothing is published."],
      };
  }
}

/** Whether WebMCP is on and broken, which the pill marks. */
export function webMcpBroken(status: PublicationStatus): boolean {
  return status.state === "unavailable" || status.state === "failed";
}

/** What the header's pill says: about the agent only. */
export function agentPill(status: AgentConnectionStatus): {
  tone: Tone;
  text: string;
  /** How the pill names itself to assistive technology. */
  label: string;
} {
  switch (status.state) {
    case "off":
      return {
        tone: "off",
        text: "No agent",
        label: "agent connection off",
      };
    case "not-connected":
      return status.reason === "reconnecting"
        ? {
            tone: "waiting",
            text: "Reconnecting",
            label: "agent reconnecting",
          }
        : {
            tone: "waiting",
            text: "Not connected",
            label: "agent not connected",
          };
    case "connected": {
      const name = agentName(status.agent) ?? "Agent";
      return { tone: "ok", text: name, label: `${name} connected` };
    }
  }
}
