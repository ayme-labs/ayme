import { describe, expect, it } from "vitest";

import { arms } from "./arms.ts";
import { claudeArguments, claudeEnvironment } from "./claude.ts";

describe("claudeEnvironment", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/Users/someone",
    CLAUDE_CONFIG_DIR: "/Users/someone/.claude",
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SESSION_ID: "session-of-the-launcher",
    ANTHROPIC_BASE_URL: "https://proxy.example",
    ANTHROPIC_MODEL: "something-else",
    MCP_TIMEOUT: "30000",
  };
  const environment = claudeEnvironment("/eval/results/claude-config", parent);

  it("drops every Claude Code and Anthropic variable of the launcher", () => {
    expect(
      Object.keys(environment).filter((key) => /^(CLAUDE|ANTHROPIC)/.test(key))
    ).toEqual(["CLAUDE_CONFIG_DIR"]);
  });

  it("points at the isolated configuration directory and keeps the rest", () => {
    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/someone",
      MCP_TIMEOUT: "30000",
      CLAUDE_CONFIG_DIR: "/eval/results/claude-config",
    });
  });

  it("leaves the parent untouched", () => {
    expect(parent.CLAUDE_CONFIG_DIR).toBe("/Users/someone/.claude");
  });
});

describe("claudeArguments", () => {
  it("loads no settings, only the arm's MCP servers and tools, and denies every prompt", () => {
    const args = claudeArguments({
      model: "sonnet",
      arm: arms["playwright-mcp"],
      mcpConfigPath: "/run/mcp.json",
    });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "sonnet",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      "/run/mcp.json",
      "--tools",
      "Read,Glob,Grep",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-session-persistence",
      "--allowedTools",
      "mcp__playwright",
    ]);
  });
});
