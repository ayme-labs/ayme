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
    surveyNameMatches: true,
    questionExists: true,
    questionHeadlineMatches: true,
  },
  expected: {
    workspaceId: "workspace-1",
    surveyId: "survey-1",
    questionId: "question-1",
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
  },
  actual: {
    surveyNames: ["Onboarding feedback run-1"],
    surveyId: "survey-1",
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
    questionHeadlineStored:
      "What would make onboarding easier for you? (run-1)",
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
    login: "first",
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
    setup: null,
    labCheckout: { movedFiles: [], modifiedFiles: [] },
    ...overrides,
  };
}

// The fixture's two turns: the setup turn (a Skill call, 8,065 tokens, $0.0312) ends with the first
// result event; the task turn (four browser calls, 48,920 tokens, $0.4633 cumulative) ends with the second.
describe("a completed run", () => {
  const result = normalizeRun(artifacts({}));

  it("records which login served the run, by name only", () => {
    expect(result.login).toBe("first");
    expect(normalizeRun(artifacts({ login: "fallback" })).login).toBe(
      "fallback"
    );
  });

  it("takes tokens from the task turn's result event alone", () => {
    expect(result.tokens).toEqual({
      input: 120,
      cacheCreation: 3000,
      cacheRead: 45000,
      output: 800,
    });
    expect(result.setup).toBeNull();
  });

  it("takes the task turn's cost as the difference of the cumulative costs", () => {
    expect(result.costUsd).toBeCloseTo(0.4633 - 0.0312, 10);
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
      aymeCommands: null,
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

  it("records what the arm's setup established before the window", () => {
    const setup = {
      tools: ["SurveyEditorPage.fillSurveyForm", "page_objects"],
    };
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

describe("a run of an arm with ayme", () => {
  const record = [
    // The setup turn's.
    '{"t":"2026-10-04T10:00:03.000Z","pid":1,"event":"start","args":["list"]}',
    '{"t":"2026-10-04T10:00:03.200Z","pid":1,"event":"end","code":0,"stdout":"","stderr":""}',
    '{"t":"2026-10-04T10:00:08.000Z","pid":2,"event":"start","args":["page-objects"]}',
    '{"t":"2026-10-04T10:00:08.300Z","pid":2,"event":"end","code":0,"stdout":"","stderr":""}',
    '{"t":"2026-10-04T10:00:09.000Z","pid":3,"event":"start","args":["call","SurveyEditorPage.saveAndClose"]}',
    '{"t":"2026-10-04T10:00:10.000Z","pid":3,"event":"end","code":1,"stdout":"","stderr":"x"}',
  ];
  const result = normalizeRun(
    artifacts({ arm: "playwright-mcp-with-ayme", aymeRecord: record })
  );

  it("counts the task turn's ayme commands apart from its tool calls, by command and tool, and the setup turn's apart", () => {
    expect(result.aymeCommands).toEqual({
      total: 2,
      failed: 1,
      byTool: {
        "ayme call SurveyEditorPage.saveAndClose": { total: 1, failed: 1 },
        "ayme page-objects": { total: 1, failed: 0 },
      },
    });
    expect(result.setupTurn.aymeCommands).toEqual({
      total: 1,
      failed: 0,
      byTool: { "ayme list": { total: 1, failed: 0 } },
    });
    expect(result.toolCalls).toEqual(normalizeRun(artifacts({})).toolCalls);
  });

  it("lists them in the summary", () => {
    expect(summarizeResult(result)).toContain(
      "- ayme commands: 2 (1 failed)\n  - ayme call SurveyEditorPage.saveAndClose: 1 (1 failed)\n  - ayme page-objects: 1 (0 failed)\n"
    );
  });

  it("has none for an arm without ayme", () => {
    const alone = normalizeRun(artifacts({}));
    expect(alone.aymeCommands).toBeNull();
    expect(alone.setupTurn.aymeCommands).toBeNull();
    expect(summarizeResult(alone)).not.toContain("ayme commands");
  });
});
