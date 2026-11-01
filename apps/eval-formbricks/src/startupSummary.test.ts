import { describe, expect, it } from "vitest";

import {
  buildStartupSummary,
  renderStartupSummaryMarkdown,
  type SummarizedStartupRun,
} from "./startupSummary.ts";

function run(overrides: Partial<SummarizedStartupRun>): SummarizedStartupRun {
  return {
    runId: "run",
    scenario: "drive-the-open-page",
    pass: true,
    wallTimeMs: 10_000,
    tokens: { input: 10, cacheCreation: 1000, cacheRead: 9000, output: 90 },
    filesRead: ["references/page-tools.md"],
    timeoutSeconds: 120,
    versions: {
      claudeCode: "2.1.281",
      model: {
        requested: "sonnet",
        used: "claude-sonnet-fixture",
        effort: "medium",
      },
      aymeCommit: "4cdac8dd",
    },
    ...overrides,
  };
}

function summarize(results: SummarizedStartupRun[]) {
  return buildStartupSummary({
    suiteId: "suite-1",
    date: "2026-10-31",
    scenarios: ["drive-the-open-page"],
    requestedRunsPerScenario: results.length,
    results,
  });
}

// Three runs: 10, 30 and 20 s; 10 100, 30 300 and 20 200 tokens.
const odd = [
  run({ runId: "a" }),
  run({
    runId: "b",
    pass: false,
    wallTimeMs: 30_000,
    tokens: { input: 30, cacheCreation: 3000, cacheRead: 27000, output: 270 },
    filesRead: ["references/page-tools.md", "references/peeks.md"],
  }),
  run({
    runId: "c",
    wallTimeMs: 20_000,
    tokens: { input: 20, cacheCreation: 2000, cacheRead: 18000, output: 180 },
  }),
];

describe("a scenario of three runs", () => {
  const [scenario] = summarize(odd).scenarios;

  it("counts its runs and passes", () => {
    expect(scenario).toMatchObject({
      scenario: "drive-the-open-page",
      runs: 3,
      passes: 2,
    });
  });

  it("takes the median, lowest and highest of setup time and tokens", () => {
    expect(scenario?.wallTimeMs).toEqual({
      n: 3,
      median: 20_000,
      min: 10_000,
      max: 30_000,
    });
    expect(scenario?.tokens).toEqual({
      n: 3,
      median: 20_200,
      min: 10_100,
      max: 30_300,
    });
  });

  it("says how many runs read each file, the most read first", () => {
    expect(scenario?.filesRead).toEqual([
      { file: "references/page-tools.md", runs: 3 },
      { file: "references/peeks.md", runs: 1 },
    ]);
  });

  it("renders its row and its file reads", () => {
    const markdown = renderStartupSummaryMarkdown(summarize(odd));
    expect(markdown).toContain(
      "| drive-the-open-page | 2 of 3 | 20.0 s (10.0 s to 30.0 s) | 20,200 (10,100 to 30,300) |"
    );
    expect(markdown).toContain(
      "| drive-the-open-page | references/page-tools.md | 3 of 3 |"
    );
    expect(markdown).toContain(
      "| drive-the-open-page | references/peeks.md | 1 of 3 |"
    );
  });
});

describe("a scenario of four runs", () => {
  it("takes the mean of the two middle values as the median", () => {
    const even = [10, 20, 30, 40].map((seconds) =>
      run({ wallTimeMs: seconds * 1000 })
    );
    expect(summarize(even).scenarios[0]?.wallTimeMs).toEqual({
      n: 4,
      median: 25_000,
      min: 10_000,
      max: 40_000,
    });
  });
});

describe("a run that timed out", () => {
  const summary = summarize([
    run({ runId: "t1" }),
    run({ runId: "t2", pass: false, wallTimeMs: null, tokens: null }),
  ]);

  it("counts in the runs and is left out of time and tokens", () => {
    expect(summary.scenarios[0]).toMatchObject({ runs: 2, passes: 1 });
    expect(summary.scenarios[0]?.wallTimeMs?.n).toBe(1);
    expect(renderStartupSummaryMarkdown(summary)).toContain(
      "10.0 s (10.0 s to 10.0 s), 1 of 2 runs"
    );
  });
});

describe("a file read outside the skill's folder", () => {
  it("counts its runs under one line, so no local path is published", () => {
    const summary = summarize([
      run({ filesRead: ["/Users/someone/ayme/package.json", "/etc/hosts"] }),
      run({ filesRead: ["references/page-tools.md"] }),
    ]);
    expect(summary.scenarios[0]?.filesRead).toEqual([
      { file: "outside the skill's folder", runs: 1 },
      { file: "references/page-tools.md", runs: 1 },
    ]);
    expect(JSON.stringify(summary)).not.toContain("/Users/someone");
  });
});

describe("several scenarios", () => {
  it("are listed in the suite's order with their own counts, a scenario without runs included", () => {
    const summary = buildStartupSummary({
      suiteId: "suite-1",
      date: "2026-10-31",
      scenarios: ["set-up-ayme", "drive-the-open-page"],
      requestedRunsPerScenario: 2,
      results: [run({ runId: "d1" })],
    });
    expect(
      summary.scenarios.map(({ scenario, runs, passes }) => [
        scenario,
        runs,
        passes,
      ])
    ).toEqual([
      ["set-up-ayme", 0, 0],
      ["drive-the-open-page", 1, 1],
    ]);
    expect(summary.notes).toEqual([
      "set-up-ayme: 0 of 2 requested runs were stored.",
      "drive-the-open-page: 1 of 2 requested runs were stored.",
    ]);
  });
});

describe("the versions a rerun must match", () => {
  it("lists them in the Markdown", () => {
    const markdown = renderStartupSummaryMarkdown(summarize(odd));
    expect(markdown).toContain("Timeout: 120 s.");
    expect(markdown).toContain("- Date: 2026-10-31");
    expect(markdown).toContain("- Claude Code: 2.1.281");
    expect(markdown).toContain(
      "- Model: claude-sonnet-fixture (requested sonnet, effort medium)"
    );
    expect(markdown).toContain("- Ayme commit: 4cdac8dd");
    expect(markdown).not.toContain("## Notes");
  });

  it("keeps every value and flags a suite that mixed them", () => {
    const summary = summarize([
      run({}),
      run({ versions: { ...run({}).versions, aymeCommit: "ffffffff" } }),
    ]);
    expect(summary.versions.aymeCommit).toEqual(["4cdac8dd", "ffffffff"]);
    expect(summary.notes).toEqual([
      "The runs differ in Ayme commits: 4cdac8dd, ffffffff. A rerun cannot match them all.",
    ]);
  });
});
