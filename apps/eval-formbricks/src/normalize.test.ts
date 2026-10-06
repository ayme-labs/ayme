import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { noGoalLoop } from "./goalLoop.ts";
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
    effort: "medium",
    timeoutSeconds: 600,
    transcript: transcript("complete.jsonl"),
    exitCode: 0,
    setupTurn: {
      sentAt: "2026-10-04T10:00:00.000Z",
      wallTimeMs: 6500,
      timedOut: false,
    },
    taskTurn: {
      sentAt: "2026-10-04T10:00:06.500Z",
      wallTimeMs: 190000,
      timedOut: false,
    },
    finishedAt: "2026-10-04T10:03:20.000Z",
    verdict: passed,
    versions: {
      claudeCode: "2.1.200",
      browserInterface: { name: "@playwright/mcp", version: "0.0.83" },
      browser: "Chrome/154.0.0.0",
      formbricksCommit: "8abe0b42",
      aymeCommit: "4cdac8dd",
    },
    goalLoop: noGoalLoop,
    setup: null,
    labCheckout: { movedFiles: [], modifiedFiles: [] },
    ...overrides,
  };
}

/** Three Goal Loop calls in the run's window, two of them answered. */
const goalLoopRan = {
  calls: 3,
  failedCalls: 1,
  usage: { input: 952, cacheCreation: 0, cacheRead: 0, output: 140 },
  generationIds: ["gen-a", "gen-b"],
  costUsd: 0.1,
  callsWithCost: 2,
};

// The fixture's two turns: the setup turn (a Skill call, 8,065 tokens, $0.0312) ends with the first
// result event; the task turn (four browser calls, 48,920 tokens, $0.4633 cumulative) ends with the second.
describe("a completed run", () => {
  const result = normalizeRun(artifacts({}));

  it("takes tokens from the task turn's result event alone", () => {
    expect(result.tokens).toEqual({
      input: 120,
      cacheCreation: 3000,
      cacheRead: 45000,
      output: 800,
    });
    expect(result.goalLoop).toEqual(noGoalLoop);
    expect(result.setup).toBeNull();
  });

  it("takes the task turn's cost as the difference of the cumulative costs", () => {
    expect(result.costUsd).toBeCloseTo(0.4633 - 0.0312, 10);
    expect(result.combinedCostUsd).toBe(result.costUsd);
    // The difference is stored free of float noise.
    expect(String(result.costUsd)).toBe("0.4321");
  });

  it("keeps the setup turn apart, with its own time, tokens, cost and tool calls", () => {
    expect(result.setupTurn).toEqual({
      sentAt: "2026-10-04T10:00:00.000Z",
      wallTimeMs: 6500,
      agentReported: { durationMs: 6100, apiDurationMs: 5200 },
      tokens: { input: 5, cacheCreation: 8000, cacheRead: 0, output: 60 },
      costUsd: 0.0312,
      numTurns: 2,
      toolCalls: {
        total: 1,
        failed: 0,
        byTool: { Skill: { total: 1, failed: 0 } },
      },
      finalMessage: "ready",
    });
    expect(result.startedAt).toBe("2026-10-04T10:00:06.500Z");
    expect(result.finishedAt).toBe("2026-10-04T10:03:20.000Z");
  });

  it("counts the tool calls made after the task message, per tool, with failures attributed to the tool that failed", () => {
    expect(result.toolCalls.byTool).not.toHaveProperty("Skill");
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
      model: {
        requested: "sonnet",
        used: "claude-sonnet-fixture",
        effort: "medium",
      },
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
      skills: ["playwright-cli"],
      plugins: [],
      permissionMode: "dontAsk",
    });
    expect(result.unparsedTranscriptLines).toBe(0);
  });

  it("names the setup turn in the summary without adding it to the figures", () => {
    const summary = summarizeResult(result);
    expect(summary).toContain("- Wall time: 190.0 s");
    expect(summary).toContain("- Cost: $0.4321");
    expect(summary).toContain(
      "- Setup turn, not counted above: 6.5 s, 8065 tokens, $0.0312, tool calls 1 (0 failed)"
    );
  });

  it("adds the Goal Loop's cost into the combined cost when it is known", () => {
    const withGoalLoop = normalizeRun(artifacts({ goalLoop: goalLoopRan }));
    expect(withGoalLoop.goalLoop).toEqual(goalLoopRan);
    expect(withGoalLoop.combinedCostUsd).toBeCloseTo(0.5321, 10);
    const summary = summarizeResult(withGoalLoop);
    expect(summary).toContain("- Goal Loop calls: 3 (1 failed)");
    expect(summary).toContain("- Goal Loop tokens: 952 in, 140 out");
    expect(summary).toContain("- Goal Loop cost: $0.1000");
    expect(summary).toContain("- Combined cost: $0.5321");
  });

  it("leaves the combined cost unknown when the Goal Loop ran at an unknown cost", () => {
    const unknownCost = normalizeRun(
      artifacts({ goalLoop: { ...goalLoopRan, costUsd: null } })
    );
    expect(unknownCost.costUsd).toBe(0.4321);
    expect(unknownCost.combinedCostUsd).toBeNull();
    const summary = summarizeResult(unknownCost);
    expect(summary).toContain("- Goal Loop cost: unknown");
    expect(summary).toContain("- Combined cost: unknown");
  });

  it("records what the arm's setup established before the window", () => {
    const setup = { goalToolPublished: true, tools: ["goal"] };
    expect(normalizeRun(artifacts({ setup })).setup).toEqual(setup);
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
    // The setup turn completed as usual; its figures stay.
    expect(result.setupTurn.costUsd).toBe(0.0312);
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
    expect(result.versions.model.effort).toBe("medium");
  });
});

describe("a run whose task turn timed out", () => {
  const result = normalizeRun(
    artifacts({
      transcript: transcript("timed-out.jsonl"),
      taskTurn: {
        sentAt: "2026-10-04T10:00:06.500Z",
        wallTimeMs: null,
        timedOut: true,
      },
      exitCode: null,
      verdict: failed,
    })
  );

  it("has no result event for the task, so its usage, cost, turns and final message are unavailable", () => {
    expect(result.agent.completed).toBe(false);
    expect(result.agent.timedOut).toBe(true);
    expect(result.agent.exitCode).toBeNull();
    expect(result.agent.numTurns).toBeNull();
    expect(result.agent.finalMessage).toBeNull();
    expect(result.tokens).toBeNull();
    expect(result.costUsd).toBeNull();
    expect(result.agentReported).toEqual({
      durationMs: null,
      apiDurationMs: null,
    });
  });

  it("still counts the task's tool calls made before the timeout, and keeps the setup turn's apart", () => {
    expect(result.toolCalls).toEqual({
      total: 3,
      failed: 1,
      byTool: {
        mcp__playwright__browser_click: { total: 1, failed: 1 },
        mcp__playwright__browser_snapshot: { total: 2, failed: 0 },
      },
    });
    expect(result.wallTimeMs).toBeNull();
    expect(result.pass).toBe(false);
    expect(result.setupTurn.wallTimeMs).toBe(6500);
    expect(result.setupTurn.tokens).toEqual({
      input: 5,
      cacheCreation: 8000,
      cacheRead: 0,
      output: 60,
    });
    expect(result.setupTurn.toolCalls.total).toBe(1);
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

describe("a run whose result lists a helper model first", () => {
  // Claude Code's modelUsage has no defined order and can include helper models.
  const lines = transcript("complete.jsonl").map((line) =>
    line.includes('"modelUsage"')
      ? line.replace(
          '"modelUsage":{',
          '"modelUsage":{"claude-helper-fixture":{"inputTokens":1,"outputTokens":1,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.0001},'
        )
      : line
  );
  const result = normalizeRun(artifacts({ transcript: lines }));

  it("reports the session's model from the init event", () => {
    expect(result.versions.model.used).toBe("claude-sonnet-fixture");
  });
});
