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
    AYME_OPENROUTER_API_KEY: "the-lab-app's-model-key",
    AYME_LAB_DECISION_USAGE_FILE: "/elsewhere/usage.jsonl",
    MCP_TIMEOUT: "30000",
  };
  const environment = claudeEnvironment(
    { configDir: "/run/claude-config", oauthToken: "token-for-the-eval" },
    parent
  );

  it("drops every Claude Code, Anthropic and Ayme variable of the launcher", () => {
    expect(
      Object.keys(environment)
        .filter((key) => /^(CLAUDE|ANTHROPIC|AYME)/.test(key))
        .sort()
    ).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]);
  });

  it("adds only the fresh configuration directory and the eval's token, keeping the rest", () => {
    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/someone",
      MCP_TIMEOUT: "30000",
      CLAUDE_CONFIG_DIR: "/run/claude-config",
      CLAUDE_CODE_OAUTH_TOKEN: "token-for-the-eval",
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
      "user",
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

describe("claudeArguments for the playwright-cli arm", () => {
  const args = claudeArguments({
    model: "sonnet",
    arm: arms["playwright-cli"],
    mcpConfigPath: "/run/mcp.json",
    readableDirectories: [
      "/run/playwright-output",
      "/run/claude-config/skills",
    ],
  });

  it("gives the agent the skill and Bash limited to the CLI, with no MCP server file entries", () => {
    expect(args).toEqual(
      expect.arrayContaining([
        "--tools",
        "Read,Glob,Grep,Bash,Skill",
        "--strict-mcp-config",
        "--allowedTools",
        "Bash(playwright-cli:*),Skill(playwright-cli)",
      ])
    );
  });

  it("lets the agent read the CLI's output folder and skill", () => {
    const index = args.indexOf("--add-dir");
    expect(args.slice(index, index + 3)).toEqual([
      "--add-dir",
      "/run/playwright-output",
      "/run/claude-config/skills",
    ]);
  });

  it("denies npx and the CLI's install and kill-all commands", () => {
    const rules = args[args.indexOf("--disallowedTools") + 1].split(",");
    expect(rules).toContain("Bash(npx:*)");
    expect(rules).toContain("Bash(playwright-cli kill-all:*)");
  });

  it("adds neither folders nor denials to an arm that has none", () => {
    const mcp = claudeArguments({
      model: "sonnet",
      arm: arms["playwright-mcp"],
      mcpConfigPath: "/run/mcp.json",
    });
    expect(mcp).not.toContain("--add-dir");
    expect(mcp).not.toContain("--disallowedTools");
  });
});
