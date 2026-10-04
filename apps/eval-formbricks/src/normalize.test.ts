import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  normalizeRun,
  summarizeResult,
  type RunArtifacts,
} from "./normalize.ts";
import type { Verdict } from "./verdict.ts";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

function transcript(name: string) {
  return readFileSync(path.join(fixturesDir, name), "utf8").split("\n");
}

const passed: Verdict = {
  pass: true,
  checks: {
    surveyExists: true,
    workspaceMatches: true,
    surveyNameMatches: true,
    questionExists: true,
    questionHeadlineMatches: true,
  },
  expected: {
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
    workspaceId: "workspace-1",
  },
  actual: {
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
    questionHeadlineStored:
      "What would make onboarding easier for you? (run-1)",
    workspaceId: "workspace-1",
  },
};

const failed: Verdict = {
  ...passed,
  pass: false,
  checks: { ...passed.checks, questionHeadlineMatches: false },
  actual: {
    ...passed.actual,
    questionHeadline: "What brought you here today? (run-1)",
    questionHeadlineStored: "What brought you here today? (run-1)",
  },
};

function artifacts(overrides: Partial<RunArtifacts>): RunArtifacts {
  return {
    runId: "run-1",
    arm: "playwright-mcp",
    missionId: "rename-survey-and-question",
    requestedModel: "sonnet",
    timeoutSeconds: 600,
    transcript: transcript("complete.jsonl"),
    exitCode: 0,
    timedOut: false,
    wallTimeMs: 190000,
    startedAt: "2026-10-04T10:00:00.000Z",
    finishedAt: "2026-10-04T10:03:15.000Z",
    verdict: passed,
    versions: {
      claudeCode: "2.1.200",
      browserInterface: { name: "@playwright/mcp", version: "0.0.83" },
      browser: "Chrome/154.0.0.0",
      formbricksCommit: "8abe0b42",
      aymeCommit: "4cdac8dd",
    },
    goalLoop: { usage: null, costUsd: null },
    labCheckoutDirty: false,
    ...overrides,
  };
}

describe("a completed run", () => {
  const result = normalizeRun(artifacts({}));

  it("takes tokens and cost from the result event", () => {
    expect(result.tokens).toEqual({
      input: 120,
      cacheCreation: 3000,
      cacheRead: 45000,
      output: 800,
    });
    expect(result.costUsd).toBe(0.4321);
    expect(result.combinedCostUsd).toBe(0.4321);
    expect(result.goalLoop).toEqual({ usage: null, costUsd: null });
  });

  it("counts tool calls per tool and attributes failures to the tool that failed", () => {
    expect(result.toolCalls).toEqual({
      total: 4,
      failed: 1,
      byTool: {
        mcp__playwright__browser_click: { total: 2, failed: 1 },
        mcp__playwright__browser_snapshot: { total: 1, failed: 0 },
        mcp__playwright__browser_type: { total: 1, failed: 0 },
      },
    });
  });

  it("keeps the agent's final message and timing without using them for the verdict", () => {
    expect(result.agent).toEqual({
      completed: true,
      timedOut: false,
      exitCode: 0,
      isError: false,
      numTurns: 5,
      assistantMessages: 5,
      permissionDenials: 0,
      finalMessage:
        'Done. The summary page at http://localhost:3000/workspaces/workspace-1/surveys/survey-1/summary shows "Onboarding feedback run-1".',
    });
    expect(result.wallTimeMs).toBe(190000);
    expect(result.agentReported).toEqual({
      durationMs: 184321,
      apiDurationMs: 151002,
    });
    expect(result.pass).toBe(true);
  });

  it("records the versions, preferring the transcript's own Claude Code version", () => {
    expect(result.versions).toEqual({
      claudeCode: "2.1.281",
      model: { requested: "sonnet", used: "claude-sonnet-fixture" },
      browserInterface: { name: "@playwright/mcp", version: "0.0.83" },
      browser: "Chrome/154.0.0.0",
      formbricksCommit: "8abe0b42",
      aymeCommit: "4cdac8dd",
    });
  });

  it("records what the agent was given as isolation evidence", () => {
    expect(result.isolation).toEqual({
      tools: [
        "Read",
        "Glob",
        "Grep",
        "mcp__playwright__browser_snapshot",
        "mcp__playwright__browser_click",
        "mcp__playwright__browser_type",
        "mcp__playwright__browser_navigate",
      ],
      mcpServers: [{ name: "playwright", status: "connected" }],
      skills: [],
      plugins: [],
      permissionMode: "dontAsk",
    });
    expect(result.unparsedTranscriptLines).toBe(0);
  });

  it("adds the Goal Loop's cost into the combined cost when it is known", () => {
    const withGoalLoop = normalizeRun(
      artifacts({ goalLoop: { usage: null, costUsd: 0.1 } })
    );
    expect(withGoalLoop.combinedCostUsd).toBeCloseTo(0.5321, 10);
  });
});

describe("a run whose result has no usage block", () => {
  const result = normalizeRun(
    artifacts({ transcript: transcript("no-usage.jsonl"), exitCode: 1 })
  );

  it("leaves tokens and cost unavailable instead of inventing zeros", () => {
    expect(result.tokens).toBeNull();
    expect(result.costUsd).toBeNull();
    expect(result.combinedCostUsd).toBeNull();
  });

  it("marks the agent as not completed and keeps the error and the denial", () => {
    expect(result.agent.completed).toBe(false);
    expect(result.agent.isError).toBe(true);
    expect(result.agent.numTurns).toBe(2);
    expect(result.agent.permissionDenials).toBe(1);
    expect(result.agent.finalMessage).toBe("API Error: 529 overloaded");
    expect(result.toolCalls.total).toBe(1);
  });

  it("falls back to the init event's model when nothing was billed", () => {
    expect(result.versions.model.used).toBe("claude-sonnet-fixture");
  });
});

describe("a timed-out run", () => {
  const result = normalizeRun(
    artifacts({
      transcript: transcript("timed-out.jsonl"),
      timedOut: true,
      exitCode: 143,
      wallTimeMs: 600000,
      verdict: failed,
    })
  );

  it("has no result event, so usage, cost, turns and final message are unavailable", () => {
    expect(result.agent.completed).toBe(false);
    expect(result.agent.timedOut).toBe(true);
    expect(result.agent.exitCode).toBe(143);
    expect(result.agent.numTurns).toBeNull();
    expect(result.agent.finalMessage).toBeNull();
    expect(result.tokens).toBeNull();
    expect(result.costUsd).toBeNull();
    expect(result.agentReported).toEqual({
      durationMs: null,
      apiDurationMs: null,
    });
  });

  it("still counts the tool calls made before the timeout", () => {
    expect(result.toolCalls).toEqual({
      total: 3,
      failed: 1,
      byTool: {
        mcp__playwright__browser_click: { total: 1, failed: 1 },
        mcp__playwright__browser_snapshot: { total: 2, failed: 0 },
      },
    });
    expect(result.wallTimeMs).toBe(600000);
    expect(result.pass).toBe(false);
  });
});

describe("a failed verdict", () => {
  const result = normalizeRun(artifacts({ verdict: failed }));

  it("fails the run although the agent's final message claims success", () => {
    expect(result.agent.completed).toBe(true);
    expect(result.agent.finalMessage).toContain("Done.");
    expect(result.pass).toBe(false);
    expect(result.verdict.checks.questionHeadlineMatches).toBe(false);
  });

  it("says so in the summary", () => {
    const summary = summarizeResult(result);
    expect(summary).toContain("- Verdict: fail");
    expect(summary).toContain("- Tool calls: 4 (1 failed)");
    expect(summary).toContain("- Cost: $0.4321");
  });
});
