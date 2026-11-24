import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { arms } from "./arms.ts";
import {
  codexArmProblem,
  codexConfig,
  codexEnvironment,
  runCodex,
  signedInWithApiKey,
} from "./codex.ts";
import { summarizeCodexTranscript } from "./codexTranscript.ts";

describe("codexEnvironment", () => {
  it("drops every agent and ayme variable of the launcher and adds the run's configuration folder alone", () => {
    expect(
      codexEnvironment(
        { configDir: "/run/codex-config" },
        {
          PATH: "/usr/bin",
          CODEX_HOME: "/Users/someone/.codex",
          OPENAI_API_KEY: "the-launcher's-key",
          CODEX_ACCESS_TOKEN: "the-launcher's-token",
          CLAUDE_CODE_OAUTH_TOKEN: "token",
          ANTHROPIC_MODEL: "something",
          AYME_OPENROUTER_API_KEY: "the-lab-app's-model-key",
        }
      )
    ).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/run/codex-config",
      HOME: "/run/codex-config",
    });
  });

  it("hides the user's home folder, where Codex would find the user's own skills", () => {
    expect(
      codexEnvironment(
        { configDir: "/run/codex-config" },
        { HOME: "/Users/someone" }
      ).HOME
    ).toBe("/run/codex-config");
  });
});

describe("signedInWithApiKey", () => {
  it("tells a sign-in that bills the API from one on a ChatGPT plan", () => {
    expect(signedInWithApiKey("Logged in using an API key - sk-***")).toBe(
      true
    );
    expect(signedInWithApiKey("Logged in using ChatGPT")).toBe(false);
  });
});

describe("codexConfig", () => {
  const config = codexConfig({
    model: "gpt-6-luna",
    mcpServers: {
      playwright: { command: "/usr/bin/node", args: ["cli.js", '--a="b"'] },
    },
    home: "/Users/someone",
  });

  it("asks no approval, reads no project instructions and searches no web", () => {
    expect(config).toContain('model = "gpt-6-luna"');
    expect(config).toContain('approval_policy = "never"');
    expect(config).toContain("project_doc_max_bytes = 0");
    expect(config).toContain('web_search = "disabled"');
  });

  it("switches off the account's apps, the shell and subagents", () => {
    expect(config).toContain("[features]\napps = false");
    expect(config).toContain("shell_tool = false");
    expect(config).toContain("[agents]\nenabled = false");
  });

  it("switches off the skills Codex ships with", () => {
    expect(config).toContain("[skills.bundled]\nenabled = false");
  });

  it("lists the arm's MCP server with every tool approved, its arguments escaped", () => {
    expect(config).toContain(
      [
        '[mcp_servers."playwright"]',
        'command = "/usr/bin/node"',
        'args = ["cli.js", "--a=\\"b\\""]',
        'env = { HOME = "/Users/someone" }',
        'default_tools_approval_mode = "approve"',
      ].join("\n")
    );
  });
});

describe("codexArmProblem", () => {
  it("accepts the arm that needs MCP servers alone", () => {
    expect(codexArmProblem(arms["playwright-mcp"])).toBeNull();
  });

  it("names an arm that needs a command line or a skill", () => {
    expect(codexArmProblem(arms["playwright-cli"])).toContain("playwright-cli");
    expect(codexArmProblem(arms["playwright-mcp-with-ayme"])).toContain(
      "playwright-mcp-with-ayme"
    );
  });
});

/**
 * The driver against a stand-in for Codex, `src/fixtures/codex-bin/codex`,
 * found through the environment's PATH.
 */
describe("runCodex", () => {
  const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures"
  );
  const workDirs: string[] = [];
  afterAll(() =>
    Promise.all(workDirs.map((dir) => rm(dir, { recursive: true })))
  );

  async function drive(
    environment: Record<string, string> = {},
    timeouts: { timeoutMs?: number; setupTimeoutMs?: number } = {}
  ) {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "eval-codex-"));
    workDirs.push(workDir);
    const stderrPath = path.join(workDir, "stderr.log");
    const run = await runCodex({
      cwd: workDir,
      environment: {
        PATH: [
          path.join(fixturesDir, "codex-bin"),
          path.dirname(process.execPath),
        ].join(path.delimiter),
        ...environment,
      },
      setupPrompt: "Get ready and reply ready.",
      prompt: "Rename the survey.",
      timeoutMs: timeouts.timeoutMs ?? 10_000,
      setupTimeoutMs: timeouts.setupTimeoutMs ?? 10_000,
      transcriptPath: path.join(workDir, "transcript.jsonl"),
      stderrPath,
    });
    return { ...run, stderr: await readFile(stderrPath, "utf8") };
  }

  it("sends the setup message, then the task after the setup turn completed, and measures each turn to its end", async () => {
    const run = await drive({ FAKE_CODEX_DELAY_MS: "150" });
    expect(run.stderr).toContain("user message 1: Get ready and reply ready.");
    expect(run.stderr).toContain("user message 2: Rename the survey.");
    expect(run.setupFailure).toBeNull();
    expect(run.setup.wallTimeMs).toBeGreaterThanOrEqual(150);
    expect(run.task?.wallTimeMs).toBeGreaterThanOrEqual(150);
    expect(run.task?.timedOut).toBe(false);
    // The streamed pieces of a message stay out of the transcript.
    expect(run.lines.join("\n")).not.toContain("item/agentMessage/delta");
  });

  it("reads the task turn's own tokens, tool calls and final message from the transcript", async () => {
    const { turns, unparsedLines } = summarizeCodexTranscript(
      (await drive()).lines
    );
    expect(unparsedLines).toBe(0);
    expect(turns).toHaveLength(2);
    const [setup, task] = turns;
    // Codex counts cached tokens inside the input tokens; here they are beside.
    expect(setup?.result?.usage).toEqual({
      input: 600,
      cacheCreation: 0,
      cacheRead: 400,
      output: 5,
    });
    // The thread's total at the task turn's end minus the setup turn's.
    expect(task?.result?.usage).toEqual({
      input: 1000,
      cacheCreation: 0,
      cacheRead: 3000,
      output: 80,
    });
    expect(task?.result).toMatchObject({
      isError: false,
      durationMs: 2400,
      cumulativeCostUsd: null,
      finalMessage: "Done.",
      modelsUsed: ["gpt-6-luna"],
    });
    expect(task?.assistantMessages).toBe(2);
    expect(task?.toolCalls).toEqual({
      total: 2,
      failed: 1,
      byTool: { mcp__playwright__browser_click: { total: 2, failed: 1 } },
    });
    expect(setup?.toolCalls.total).toBe(0);
    expect(task?.init).toMatchObject({
      model: "gpt-6-luna",
      permissionMode: "never",
      mcpServers: [{ name: "playwright", status: "ready" }],
    });
  });

  it("never sends the task after a setup turn that ends failed", async () => {
    const run = await drive({ FAKE_CODEX_FAIL_TURN: "1" });
    expect(run.setupFailure).toBe("the setup turn ended with an error");
    expect(run.task).toBeNull();
    expect(run.stderr).not.toContain("user message 2:");
  });

  it("stops a setup turn that runs out of its own timeout", async () => {
    const run = await drive(
      { FAKE_CODEX_HANG_TURN: "1" },
      { setupTimeoutMs: 300 }
    );
    expect(run.setupFailure).toBe(
      "the setup turn ran out of its 0.3 s timeout"
    );
    expect(run.task).toBeNull();
  });

  it("stops a server that never answers when the setup turn's timeout runs out", async () => {
    const run = await drive(
      { FAKE_CODEX_SILENT: "1" },
      { setupTimeoutMs: 300 }
    );
    expect(run.setupFailure).toBe(
      "the setup turn ran out of its 0.3 s timeout"
    );
    expect(run.setup.timedOut).toBe(true);
    expect(run.task).toBeNull();
  });

  it("stops the agent when the task turn runs out of the timeout, keeping the turn's events", async () => {
    const run = await drive({ FAKE_CODEX_HANG_TURN: "2" }, { timeoutMs: 300 });
    expect(run.setupFailure).toBeNull();
    expect(run.task).toEqual({
      sentAt: expect.any(String),
      wallTimeMs: null,
      timedOut: true,
    });
    expect(run.signal).toBe("SIGTERM");
    const { turns } = summarizeCodexTranscript(run.lines);
    expect(turns).toHaveLength(2);
    expect(turns[1]?.result).toBeNull();
  });
});

describe("summarizeCodexTranscript", () => {
  it("counts a tool call the timeout cut short, as a Claude Code transcript does", () => {
    const call = (id: string) => ({
      type: "mcpToolCall",
      id,
      server: "playwright",
      tool: "browser_click",
    });
    const { turns } = summarizeCodexTranscript(
      [
        { method: "turn/started", params: {} },
        { method: "item/started", params: { item: call("a") } },
        {
          method: "item/completed",
          params: { item: { ...call("a"), status: "completed" } },
        },
        { method: "item/started", params: { item: call("b") } },
      ].map((message) => JSON.stringify(message))
    );
    expect(turns[0]?.toolCalls).toEqual({
      total: 2,
      failed: 0,
      byTool: { mcp__playwright__browser_click: { total: 2, failed: 0 } },
    });
  });
});
