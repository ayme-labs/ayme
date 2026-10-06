import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { noGoalLoop } from "./goalLoop.ts";
import { normalizeRun } from "./normalize.ts";
import { parseStoredRun, parseSuiteManifest } from "./store.ts";
import {
  buildSummary,
  renderSummaryMarkdown,
  spread,
  type SummarizedRun,
} from "./summary.ts";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

function run(overrides: Partial<SummarizedRun>): SummarizedRun {
  return {
    runId: "run",
    arm: "playwright-mcp",
    mission: "rename-survey-and-question",
    pass: true,
    wallTimeMs: 100_000,
    tokens: { input: 10, cacheCreation: 1000, cacheRead: 9000, output: 90 },
    combinedCostUsd: 0.1,
    goalLoop: { calls: 0, costUsd: null },
    toolCallTotal: 10,
    timeoutSeconds: 600,
    labCheckoutDirty: false,
    versions: {
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
    },
    ...overrides,
  };
}

function summarize(results: SummarizedRun[], arms = ["playwright-mcp"]) {
  return buildSummary({
    suiteId: "suite-1",
    date: "2026-10-04",
    arms,
    requestedRunsPerArm: results.length,
    results,
  });
}

// Three runs: wall 100, 200 and 150 s; 10, 14 and 12 tool calls; input and output 100, 200 and 150
// tokens of totals 10 100, 20 200 and 15 150; $0.10, $0.30 and $0.20.
const odd = [
  run({ runId: "a" }),
  run({
    runId: "b",
    wallTimeMs: 200_000,
    tokens: { input: 20, cacheCreation: 2000, cacheRead: 18000, output: 180 },
    combinedCostUsd: 0.3,
    toolCallTotal: 14,
  }),
  run({
    runId: "c",
    wallTimeMs: 150_000,
    tokens: { input: 15, cacheCreation: 1500, cacheRead: 13500, output: 135 },
    combinedCostUsd: 0.2,
    toolCallTotal: 12,
  }),
];

describe("the spread of a metric", () => {
  it("is the middle value with the lowest and highest for an odd count", () => {
    expect(spread([3, 1, 2])).toEqual({ n: 3, median: 2, min: 1, max: 3 });
  });

  it("is the mean of the two middle values for an even count", () => {
    expect(spread([40, 10, 30, 20])).toEqual({
      n: 4,
      median: 25,
      min: 10,
      max: 40,
    });
  });

  it("is the value itself for one run", () => {
    expect(spread([7])).toEqual({ n: 1, median: 7, min: 7, max: 7 });
  });

  it("skips missing values and is null when none are left", () => {
    expect(spread([null, 5, null, 1])).toEqual({
      n: 2,
      median: 3,
      min: 1,
      max: 5,
    });
    expect(spread([null, null])).toBeNull();
  });
});

describe("a suite of three runs", () => {
  const [arm] = summarize(odd).arms;

  it("takes the median, lowest and highest of wall time, tokens and combined cost", () => {
    expect(arm?.wallTimeMs).toEqual({
      n: 3,
      median: 150_000,
      min: 100_000,
      max: 200_000,
    });
    expect(arm?.tokens).toEqual({
      n: 3,
      median: 15_150,
      min: 10_100,
      max: 20_200,
    });
    expect(arm?.combinedCostUsd).toEqual({
      n: 3,
      median: 0.2,
      min: 0.1,
      max: 0.3,
    });
  });

  it("takes the spread of tool calls and of input and output tokens without the cache", () => {
    expect(arm?.toolCalls).toEqual({ n: 3, median: 12, min: 10, max: 14 });
    expect(arm?.inputOutputTokens).toEqual({
      n: 3,
      median: 150,
      min: 100,
      max: 200,
    });
  });

  it("renders the arm's row", () => {
    expect(renderSummaryMarkdown(summarize(odd))).toContain(
      "| playwright-mcp | 3 of 3 | 150.0 s (100.0 s to 200.0 s) | 12 (10 to 14) | 150 (100 to 200) | 15,150 (10,100 to 20,200) | $0.200 ($0.100 to $0.300) |"
    );
  });
});

describe("a suite of four runs", () => {
  const even = [10, 20, 30, 40].map((seconds, index) =>
    run({
      runId: `e${index}`,
      wallTimeMs: seconds * 1000,
      combinedCostUsd: (index + 1) / 10,
    })
  );
  const [arm] = summarize(even).arms;

  it("takes the mean of the two middle values as the median", () => {
    expect(arm?.wallTimeMs).toEqual({
      n: 4,
      median: 25_000,
      min: 10_000,
      max: 40_000,
    });
    expect(arm?.combinedCostUsd?.median).toBeCloseTo(0.25);
    expect(arm?.combinedCostUsd?.min).toBeCloseTo(0.1);
    expect(arm?.combinedCostUsd?.max).toBeCloseTo(0.4);
  });
});

describe("failed runs", () => {
  const results = [
    run({ runId: "p1" }),
    run({ runId: "f1", pass: false, wallTimeMs: 600_000 }),
    run({ runId: "p2", wallTimeMs: 300_000 }),
  ];
  const [arm] = summarize(results).arms;

  it("count in the runs but not in the passes", () => {
    expect(arm?.passes).toBe(2);
    expect(arm?.runs).toBe(3);
    expect(renderSummaryMarkdown(summarize(results))).toContain(
      "| playwright-mcp | 2 of 3 |"
    );
  });

  it("still contribute their time, tokens and cost", () => {
    expect(arm?.wallTimeMs).toEqual({
      n: 3,
      median: 300_000,
      min: 100_000,
      max: 600_000,
    });
  });
});

describe("a run without usage data", () => {
  const results = [
    run({ runId: "u1" }),
    run({ runId: "u2", tokens: null, combinedCostUsd: null, pass: false }),
    run({
      runId: "u3",
      tokens: { input: 20, cacheCreation: 2000, cacheRead: 18000, output: 180 },
      combinedCostUsd: 0.3,
    }),
  ];
  const summary = summarize(results);
  const [arm] = summary.arms;

  it("counts in the passes and runs and is left out of tokens and cost", () => {
    expect(arm?.runs).toBe(3);
    expect(arm?.passes).toBe(2);
    expect(arm?.tokens).toEqual({
      n: 2,
      median: 15_150,
      min: 10_100,
      max: 20_200,
    });
    expect(arm?.combinedCostUsd?.n).toBe(2);
    expect(arm?.runList[1]).toMatchObject({
      runId: "u2",
      usage: null,
      totalTokens: null,
      combinedCostUsd: null,
    });
  });

  it("says in the table and the notes how many runs the figure rests on", () => {
    expect(renderSummaryMarkdown(summary)).toContain(
      "15,150 (10,100 to 20,200), 2 of 3 runs"
    );
    expect(summary.notes).toContain(
      "playwright-mcp: tokens is over 2 of 3 runs; the others have no data."
    );
  });

  it("shows unknown when no run has the figure", () => {
    const none = summarize([run({ tokens: null, combinedCostUsd: null })]);
    expect(none.arms[0]?.tokens).toBeNull();
    expect(renderSummaryMarkdown(none)).toContain("| unknown | unknown |");
  });
});

describe("a run whose Goal Loop cost is unknown", () => {
  const results = [
    run({
      runId: "g1",
      arm: "ayme-goal-loop-on",
      combinedCostUsd: null,
      goalLoop: { calls: 12, costUsd: null },
    }),
    run({
      runId: "g2",
      arm: "ayme-goal-loop-on",
      combinedCostUsd: 0.15,
      goalLoop: { calls: 9, costUsd: 0.05 },
    }),
  ];
  const summary = summarize(results, ["ayme-goal-loop-on"]);

  it("has an unknown combined cost, shown as such, and the summary says why", () => {
    expect(summary.arms[0]?.combinedCostUsd).toEqual({
      n: 1,
      median: 0.15,
      min: 0.15,
      max: 0.15,
    });
    expect(renderSummaryMarkdown(summary)).toContain(
      "$0.150 ($0.150 to $0.150), 1 of 2 runs"
    );
    expect(summary.notes).toContain(
      "ayme-goal-loop-on: the Goal Loop's cost is unknown in 1 of 2 runs, so their combined cost is unknown."
    );
  });

  it("is not noted for arms whose Goal Loop made no call", () => {
    expect(summarize(odd).notes).toEqual([]);
  });
});

describe("several arms", () => {
  const results = [
    run({ runId: "m1" }),
    run({
      runId: "x1",
      arm: "other-arm",
      pass: false,
      versions: {
        ...run({}).versions,
        browserInterface: { name: "other-interface", version: "1.2.3" },
      },
    }),
  ];
  const summary = summarize(results, ["other-arm", "playwright-mcp"]);

  it("lists them in the requested order with their own counts", () => {
    expect(summary.arms.map((arm) => [arm.arm, arm.passes, arm.runs])).toEqual([
      ["other-arm", 0, 1],
      ["playwright-mcp", 1, 1],
    ]);
  });

  it("records each arm's pinned interface", () => {
    expect(summary.versions.browserInterfaces).toEqual([
      { arm: "playwright-mcp", name: "@playwright/mcp", version: "0.0.83" },
      { arm: "other-arm", name: "other-interface", version: "1.2.3" },
    ]);
  });
});

describe("the versions a rerun must match", () => {
  it("lists them in the Markdown", () => {
    const markdown = renderSummaryMarkdown(summarize(odd));
    expect(markdown).toContain("- Date: 2026-10-04");
    expect(markdown).toContain("- Claude Code: 2.1.281");
    expect(markdown).toContain(
      "- Model: claude-sonnet-fixture (requested sonnet, effort medium)"
    );
    expect(markdown).toContain("- @playwright/mcp 0.0.83 (playwright-mcp)");
    expect(markdown).toContain("- Ayme commit: 4cdac8dd");
    expect(markdown).toContain("- Formbricks commit: 8abe0b42");
    expect(markdown).not.toContain("## Notes");
  });

  it("keeps every value and flags a suite that mixed them", () => {
    const summary = summarize([
      run({ runId: "v1" }),
      run({
        runId: "v2",
        versions: { ...run({}).versions, aymeCommit: "ffffffff" },
      }),
    ]);
    expect(summary.versions.aymeCommit).toEqual(["4cdac8dd", "ffffffff"]);
    expect(summary.notes).toContain(
      "The runs differ in Ayme commits: 4cdac8dd, ffffffff. A rerun cannot match them all."
    );
  });

  it("notes arms with fewer stored runs than requested", () => {
    const summary = buildSummary({
      suiteId: "suite-1",
      date: "2026-10-04",
      arms: ["playwright-mcp"],
      requestedRunsPerArm: 3,
      results: [run({ runId: "only" })],
    });
    expect(summary.notes).toContain(
      "playwright-mcp: 1 of 3 requested runs were stored."
    );
  });
});

describe("reading stored files", () => {
  const stored = normalizeRun({
    runId: "stored-1",
    arm: "playwright-mcp",
    missionId: "rename-survey-and-question",
    requestedModel: "sonnet",
    effort: "medium",
    timeoutSeconds: 600,
    transcript: readFileSync(
      path.join(fixturesDir, "complete.jsonl"),
      "utf8"
    ).split("\n"),
    exitCode: 0,
    setupTurn: {
      sentAt: "2026-10-04T10:00:00.000Z",
      wallTimeMs: 6500,
      timedOut: false,
    },
    taskTurn: {
      sentAt: "2026-10-04T10:00:06.500Z",
      wallTimeMs: 190_000,
      timedOut: false,
    },
    finishedAt: "2026-10-04T10:03:20.000Z",
    verdict: {
      pass: true,
      checks: {
        surveyExists: true,
        surveyNameMatches: true,
        questionExists: true,
        questionHeadlineMatches: true,
      },
      expected: {
        workspaceId: "w",
        surveyId: "s",
        questionId: "q",
        surveyName: "n",
        questionHeadline: "h",
      },
      actual: {
        surveyNames: ["n"],
        surveyId: "s",
        surveyName: "n",
        questionHeadline: "h",
        questionHeadlineStored: "h",
      },
    },
    versions: {
      claudeCode: null,
      browserInterface: { name: "@playwright/mcp", version: "0.0.83" },
      browser: null,
      formbricksCommit: "8abe0b42",
      aymeCommit: "4cdac8dd",
    },
    goalLoop: noGoalLoop,
    setup: null,
    labCheckout: { movedFiles: [], modifiedFiles: [] },
  });

  it("summarizes a result.json as the run command wrote it", () => {
    const parsed = parseStoredRun(
      JSON.parse(JSON.stringify(stored)),
      "result.json"
    );
    // Recorded in the fixture's task turn: 120 + 3000 + 45000 + 800 tokens, $0.4633 cumulative after a $0.0312 setup turn.
    const [arm] = summarize([parsed]).arms;
    expect(arm?.tokens?.median).toBe(48_920);
    expect(arm?.combinedCostUsd?.median).toBeCloseTo(0.4321, 10);
    expect(arm?.wallTimeMs?.median).toBe(190_000);
    expect(parsed.versions.claudeCode).toBe("2.1.281");
    expect(parsed.goalLoop).toEqual({ calls: 0, costUsd: null });
  });

  it("reads a result stored before the Goal Loop was measured as one without calls", () => {
    // JSON drops the undefined field, as an older result.json never had it.
    const parsed = parseStoredRun(
      JSON.parse(JSON.stringify({ ...stored, goalLoop: undefined })),
      "result.json"
    );
    expect(parsed.goalLoop).toEqual({ calls: 0, costUsd: null });
  });

  it("names the file and field of a result it cannot read", () => {
    expect(() =>
      parseStoredRun({ ...stored, pass: "yes" }, "runs/x/result.json")
    ).toThrow("runs/x/result.json: expected boolean pass");
  });

  it("reads a suite manifest", () => {
    const manifest = {
      suiteId: "suite-1",
      startedAt: "2026-10-04T10:00:00.000Z",
      finishedAt: null,
      model: "sonnet",
      timeoutSeconds: 600,
      mission: "rename-survey-and-question",
      arms: ["playwright-mcp"],
      runsPerArm: 3,
      runIds: ["a", "b"],
      error: null,
    };
    expect(parseSuiteManifest(manifest)).toEqual(manifest);
    expect(() => parseSuiteManifest({ ...manifest, runIds: [1] })).toThrow(
      "expected a list of strings runIds"
    );
  });
});
