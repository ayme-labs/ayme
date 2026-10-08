import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { arms } from "./arms.ts";
import {
  claudeArguments,
  claudeEnvironment,
  runClaude,
  userMessageLine,
  type ClaudeRun,
} from "./claude.ts";
import { summarizeTranscript } from "./transcript.ts";

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
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "sonnet",
      "--effort",
      "medium",
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

describe("userMessageLine", () => {
  it("is one stream-json user message with the text, newline-terminated", () => {
    expect(userMessageLine("Reply ready.")).toBe(
      `${JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "Reply ready." }],
        },
      })}\n`
    );
  });
});

/**
 * The driver against a stand-in for Claude Code, `src/fixtures/bin/claude`,
 * found through the environment's PATH: it replays a fixture transcript one
 * turn per user message, and hangs in a turn that has no result event.
 */
describe("runClaude", () => {
  const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures"
  );
  const workDirs: string[] = [];
  afterAll(() =>
    Promise.all(workDirs.map((dir) => rm(dir, { recursive: true })))
  );

  async function drive(options: {
    fixture: string;
    timeoutMs?: number;
    setupTimeoutMs?: number;
    resultDelayMs?: number;
  }): Promise<ClaudeRun & { stderr: string }> {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "eval-claude-"));
    workDirs.push(workDir);
    const stderrPath = path.join(workDir, "stderr.log");
    const run = await runClaude({
      cwd: workDir,
      environment: {
        PATH: [
          path.join(fixturesDir, "bin"),
          path.dirname(process.execPath),
        ].join(path.delimiter),
        FAKE_CLAUDE_TRANSCRIPT: path.join(fixturesDir, options.fixture),
        FAKE_CLAUDE_RESULT_DELAY_MS: String(options.resultDelayMs ?? 0),
      },
      model: "sonnet",
      arm: arms["playwright-mcp"],
      mcpConfigPath: path.join(workDir, "mcp.json"),
      setupPrompt: "Get ready and reply ready.",
      prompt: "Rename the survey.",
      timeoutMs: options.timeoutMs ?? 10_000,
      setupTimeoutMs: options.setupTimeoutMs ?? 10_000,
      transcriptPath: path.join(workDir, "transcript.jsonl"),
      stderrPath,
    });
    return { ...run, stderr: await readFile(stderrPath, "utf8") };
  }

  it("sends the setup message, then the task after the setup turn's result, and measures each turn to its result event", async () => {
    const run = await drive({ fixture: "complete.jsonl", resultDelayMs: 150 });
    expect(run.stderr).toContain("user message 1: Get ready and reply ready.");
    expect(run.stderr).toContain("user message 2: Rename the survey.");
    expect(run.setupFailure).toBeNull();
    expect(run.task).not.toBeNull();
    expect(run.setup.timedOut).toBe(false);
    expect(run.task?.timedOut).toBe(false);
    // Each turn waits for its own result event, delayed by the stand-in.
    expect(run.setup.wallTimeMs).toBeGreaterThanOrEqual(150);
    expect(run.task?.wallTimeMs).toBeGreaterThanOrEqual(150);
    expect(Date.parse(run.task!.sentAt)).toBeGreaterThanOrEqual(
      Date.parse(run.setup.sentAt) + run.setup.wallTimeMs!
    );
    expect(run.exitCode).toBe(0);
    // The whole transcript, both turns, is kept.
    expect(summarizeTranscript(run.lines).turns).toHaveLength(2);
    expect(run.lines).toHaveLength(16);
  });

  it("never sends the task after a setup turn that ends with an error", async () => {
    const run = await drive({ fixture: "setup-failed.jsonl" });
    expect(run.setupFailure).toBe("the setup turn ended with an error");
    expect(run.task).toBeNull();
    expect(run.stderr).toContain("user message 1:");
    expect(run.stderr).not.toContain("user message 2:");
    expect(summarizeTranscript(run.lines).turns).toHaveLength(1);
  });

  it("stops a setup turn that runs out of its own timeout", async () => {
    // The fixture's one turn never ends.
    const run = await drive({
      fixture: "setup-hangs.jsonl",
      setupTimeoutMs: 300,
    });
    expect(run.setup.timedOut).toBe(true);
    expect(run.setupFailure).toBe(
      "the setup turn ran out of its 0.3 s timeout"
    );
    expect(run.task).toBeNull();
  });

  it("stops the agent when the task turn runs out of the timeout, keeping the setup turn's figures", async () => {
    const run = await drive({ fixture: "timed-out.jsonl", timeoutMs: 300 });
    expect(run.setupFailure).toBeNull();
    expect(run.setup.timedOut).toBe(false);
    expect(run.setup.wallTimeMs).not.toBeNull();
    expect(run.task).toEqual({
      sentAt: expect.any(String),
      wallTimeMs: null,
      timedOut: true,
    });
    expect(run.exitCode).toBeNull();
    expect(run.signal).toBe("SIGTERM");
    const { turns } = summarizeTranscript(run.lines);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.result).not.toBeNull();
    expect(turns[1]?.result).toBeNull();
  });
});
