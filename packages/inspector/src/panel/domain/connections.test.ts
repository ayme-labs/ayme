import { describe, expect, it } from "vitest";

import {
  agentName,
  agentPill,
  agentRow,
  webMcpBroken,
  webMcpRow,
  type AgentConnectionStatus,
  type PublicationStatus,
} from "./connections";

// Unit tests: what the Connections pill and popover say for each status.

const FIX =
  "Ask your agent to call ayme_connect and open the link it gives you.";

describe("agentName", () => {
  it.each([
    ["claude-code", "Claude Code"],
    ["codex-mcp-client", "Codex"],
    ["cursor-vscode", "Cursor"],
    ["my-agent", "my-agent"],
  ])("shows %s as %s", (sent, shown) => {
    expect(agentName(sent)).toBe(shown);
  });

  it("has none when the client sent none", () => {
    expect(agentName(undefined)).toBeUndefined();
  });
});

describe("agentPill", () => {
  it.each<[AgentConnectionStatus, string, string]>([
    [{ state: "off" }, "No agent", "agent connection off"],
    [
      { state: "not-connected", reason: "no-server" },
      "Not connected",
      "agent not connected",
    ],
    [
      { state: "connected", agent: "claude-code" },
      "Claude Code",
      "Claude Code connected",
    ],
    [{ state: "connected" }, "Agent", "Agent connected"],
  ])("says %j as %s", (status, text, label) => {
    expect(agentPill(status)).toMatchObject({ text, label });
  });
});

describe("agentRow", () => {
  it.each<
    [AgentConnectionStatus["state"] | string, AgentConnectionStatus, string[]]
  >([
    [
      "connected",
      { state: "connected", agent: "codex-mcp-client" },
      ["Codex is connected to this tab through ayme mcp."],
    ],
    [
      "connected without a name",
      { state: "connected" },
      ["An agent is connected to this tab through ayme mcp."],
    ],
    [
      "not connected, before the tab knows why",
      { state: "not-connected" },
      [FIX],
    ],
    [
      "connecting",
      { state: "not-connected", reason: "connecting" },
      ["Connecting to your agent's ayme MCP server."],
    ],
    [
      "no server",
      { state: "not-connected", reason: "no-server" },
      ["No ayme MCP server is running on this machine.", FIX],
    ],
    [
      "several servers",
      { state: "not-connected", reason: "several-servers" },
      [
        "More than one ayme MCP server is running, so this tab won't guess which one.",
        FIX,
      ],
    ],
    [
      "another tab",
      { state: "not-connected", reason: "other-tab" },
      ["Your agent is working in another tab.", FIX],
    ],
    [
      "not on localhost",
      { state: "not-connected", reason: "not-local" },
      [
        "This page isn't on localhost, so it doesn't look for a server by itself.",
        FIX,
      ],
    ],
    [
      "no answer",
      { state: "not-connected", reason: "no-answer" },
      ["The ayme MCP server this tab connected to stopped answering.", FIX],
    ],
  ])("says why when %s", (_case, status, lines) => {
    expect(agentRow(status).lines).toEqual(lines);
  });

  it("offers the option that turns it on while it is off", () => {
    expect(agentRow({ state: "off" })).toMatchObject({
      label: "Off",
      snippet: "agentConnection: true",
    });
  });
});

describe("webMcpRow", () => {
  it.each<[PublicationStatus, string, string]>([
    [
      { state: "active", message: "" },
      "Published",
      "3 tools published to agents in this browser.",
    ],
    [
      { state: "waiting", message: "Waiting for the WebMCP driver." },
      "On",
      "Publishing to agents in this browser once WebMCP is ready.",
    ],
    [
      { state: "disabled", message: "WebMCP publication is disabled." },
      "Off",
      "For agents that live in this browser, such as an extension.",
    ],
    [
      { state: "unavailable", message: "The WebMCP driver is unavailable." },
      "Unavailable",
      "This browser has no WebMCP. Load the WebMCP polyfill, or turn on the browser's WebMCP flag.",
    ],
    [
      {
        state: "failed",
        message: "WebMCP publication failed: a name is taken.",
      },
      "Failed",
      "WebMCP publication failed: a name is taken.",
    ],
    [
      { state: "disposed", message: "No Ayme runtime session has started." },
      "Stopped",
      "No Ayme runtime session is running, so nothing is published.",
    ],
  ])("says %j as %s", (status, label, line) => {
    expect(webMcpRow(status, 3)).toMatchObject({ label, lines: [line] });
  });

  it("counts one tool as one", () => {
    expect(webMcpRow({ state: "active", message: "" }, 1).lines).toEqual([
      "1 tool published to agents in this browser.",
    ]);
  });

  it("offers the option that turns it on while it is off", () => {
    expect(webMcpRow({ state: "disabled", message: "" }, 0).snippet).toBe(
      "webMCP: { enabled: true }"
    );
  });
});

describe("webMcpBroken", () => {
  it.each<[PublicationStatus["state"], boolean]>([
    ["active", false],
    ["waiting", false],
    ["disabled", false],
    ["disposed", false],
    ["unavailable", true],
    ["failed", true],
  ])("is %s → %s", (state, broken) => {
    expect(webMcpBroken({ state, message: "" })).toBe(broken);
  });
});
