/**
 * A startup suite's summary: stored run results in, per scenario the passes,
 * how many runs read each file and the median/lowest/highest of setup time and
 * tokens out, with the versions a rerun has to match. Pure, like `summary.ts`,
 * whose spread and formats it shares.
 */
import path from "node:path";

import type { StartupResult } from "./startup.ts";
import {
  count,
  distinct,
  list,
  range,
  seconds,
  spread,
  type Spread,
} from "./summary.ts";
import { totalTokens } from "./transcript.ts";

/** The part of a stored result the summary reads. */
export type SummarizedStartupRun = Pick<
  StartupResult,
  | "runId"
  | "scenario"
  | "pass"
  | "wallTimeMs"
  | "tokens"
  | "filesRead"
  | "timeoutSeconds"
  | "versions"
>;

export type ScenarioSummary = {
  scenario: string;
  /** Runs stored for this scenario. */
  runs: number;
  requestedRuns: number;
  passes: number;
  /** The runs that read each file, the most read first. */
  filesRead: { file: string; runs: number }[];
  wallTimeMs: Spread | null;
  /** Input, cache creation, cache read and output tokens, added up. */
  tokens: Spread | null;
};

export type StartupSummary = {
  suiteId: string;
  /** The day the suite started, UTC. */
  date: string;
  timeoutSeconds: number[];
  versions: {
    claudeCode: string[];
    modelRequested: string[];
    modelUsed: string[];
    effort: string[];
    aymeCommit: string[];
  };
  scenarios: ScenarioSummary[];
  /** Things a reader must know before trusting the numbers. */
  notes: string[];
};

/** Files outside the skill are stored as absolute paths, which a committed summary must not carry. */
const outsideTheSkill = "outside the skill's folder";

function filesRead(runs: SummarizedStartupRun[]) {
  const reads = runs.flatMap(({ filesRead: files }) => [
    ...new Set(
      files.map((file) => (path.isAbsolute(file) ? outsideTheSkill : file))
    ),
  ]);
  return [...new Set(reads)]
    .map((file) => ({
      file,
      runs: reads.filter((read) => read === file).length,
    }))
    .sort((a, b) => b.runs - a.runs || a.file.localeCompare(b.file));
}

export function buildStartupSummary(input: {
  suiteId: string;
  date: string;
  /** In the suite's order. */
  scenarios: string[];
  requestedRunsPerScenario: number;
  results: SummarizedStartupRun[];
}): StartupSummary {
  const { results } = input;
  const scenarios = input.scenarios.map((scenario): ScenarioSummary => {
    const runs = results.filter((result) => result.scenario === scenario);
    return {
      scenario,
      runs: runs.length,
      requestedRuns: input.requestedRunsPerScenario,
      passes: runs.filter((run) => run.pass).length,
      filesRead: filesRead(runs),
      wallTimeMs: spread(runs.map((run) => run.wallTimeMs)),
      tokens: spread(
        runs.map((run) => (run.tokens ? totalTokens(run.tokens) : null))
      ),
    };
  });
  const versions: StartupSummary["versions"] = {
    claudeCode: distinct(results.map((r) => r.versions.claudeCode)),
    modelRequested: distinct(results.map((r) => r.versions.model.requested)),
    modelUsed: distinct(results.map((r) => r.versions.model.used)),
    effort: distinct(results.map((r) => r.versions.model.effort)),
    aymeCommit: distinct(results.map((r) => r.versions.aymeCommit)),
  };
  const timeoutSeconds = [...new Set(results.map((r) => r.timeoutSeconds))];

  const notes = scenarios
    .filter(({ runs, requestedRuns }) => runs < requestedRuns)
    .map(
      ({ scenario, runs, requestedRuns }) =>
        `${scenario}: ${runs} of ${requestedRuns} requested runs were stored.`
    );
  const mixed = [
    ["Claude Code versions", versions.claudeCode],
    ["models", versions.modelUsed],
    ["thinking efforts", versions.effort],
    ["Ayme commits", versions.aymeCommit],
    ["timeouts", timeoutSeconds.map(String)],
  ] as const;
  for (const [label, values] of mixed)
    if (values.length > 1)
      notes.push(
        `The runs differ in ${label}: ${values.join(", ")}. A rerun cannot match them all.`
      );

  return {
    suiteId: input.suiteId,
    date: input.date,
    timeoutSeconds,
    versions,
    scenarios,
    notes,
  };
}

/** The summary as a committed Markdown page. */
export function renderStartupSummaryMarkdown(summary: StartupSummary) {
  const { versions } = summary;
  const lines = [
    `# Startup lane summary, ${summary.date}`,
    "",
    `Suite \`${summary.suiteId}\`. Timeout: ${list(summary.timeoutSeconds.map((s) => `${s} s`))}.`,
    "",
    "Passes are out of the runs stored for the scenario. Each cell is the median, then the lowest and highest in parentheses. Setup time runs from sending the one message to its result; tokens add up input, cache creation, cache read and output. A run that timed out has neither.",
    "",
    "| Scenario | Passes | Setup time | Tokens |",
    "| --- | --- | --- | --- |",
    ...summary.scenarios.map(
      ({ scenario, passes, runs, wallTimeMs, tokens }) =>
        `| ${scenario} | ${passes} of ${runs} | ${range(wallTimeMs, seconds, runs)} | ${range(tokens, count, runs)} |`
    ),
    "",
    "## Files read",
    "",
    "| Scenario | File | Runs that read it |",
    "| --- | --- | --- |",
    ...summary.scenarios.flatMap(({ scenario, runs, filesRead: files }) =>
      files.map(
        ({ file, runs: reads }) =>
          `| ${scenario} | ${file} | ${reads} of ${runs} |`
      )
    ),
    "",
    "## Versions a rerun must match",
    "",
    `- Date: ${summary.date}`,
    `- Claude Code: ${list(versions.claudeCode)}`,
    `- Model: ${list(versions.modelUsed)} (requested ${list(versions.modelRequested)}, effort ${list(versions.effort)})`,
    `- Ayme commit: ${list(versions.aymeCommit)}`,
  ];
  if (summary.notes.length > 0)
    lines.push("", "## Notes", "", ...summary.notes.map((note) => `- ${note}`));
  return `${lines.join("\n")}\n`;
}
