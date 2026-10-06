/**
 * The suite summary: stored run results in, per-arm pass counts and
 * median/lowest/highest of wall time, tokens and combined cost out, with the
 * versions a rerun has to match. Pure; reading the stored runs and writing the
 * files are the callers' job.
 */
import type { NormalizedResult } from "./normalize.ts";
import { totalTokens, type TokenUsage } from "./transcript.ts";

/** The part of a stored result the summary reads. */
export type SummarizedRun = Pick<
  NormalizedResult,
  | "runId"
  | "arm"
  | "mission"
  | "pass"
  | "wallTimeMs"
  | "tokens"
  | "combinedCostUsd"
  | "timeoutSeconds"
  | "labCheckoutDirty"
> & {
  /** The Goal Loop's calls and cost; a run with calls but no cost has an unknown combined cost. */
  goalLoop: Pick<NormalizedResult["goalLoop"], "calls" | "costUsd">;
  /** The agent's tool calls in the task turn; `null` for a result stored without them. */
  toolCallTotal: number | null;
  versions: Pick<
    NormalizedResult["versions"],
    | "claudeCode"
    | "model"
    | "browserInterface"
    | "browser"
    | "formbricksCommit"
    | "aymeCommit"
  >;
};

/** Median, lowest and highest over the runs that have the value. */
export type Spread = {
  /** How many runs had the value; fewer than the arm's runs when usage was missing. */
  n: number;
  median: number;
  min: number;
  max: number;
};

export type ArmSummary = {
  arm: string;
  /** Runs stored for this arm. */
  runs: number;
  /** Runs the suite was asked for, when known. */
  requestedRuns: number | null;
  passes: number;
  wallTimeMs: Spread | null;
  /** Input, cache creation, cache read and output tokens of the agent, added up. */
  tokens: Spread | null;
  /** The agent's input and output tokens alone, without cache reads and writes. */
  inputOutputTokens: Spread | null;
  /** The agent's tool calls in the task turn. */
  toolCalls: Spread | null;
  combinedCostUsd: Spread | null;
  runList: {
    runId: string;
    pass: boolean;
    wallTimeMs: number | null;
    usage: TokenUsage | null;
    totalTokens: number | null;
    combinedCostUsd: number | null;
  }[];
};

export type SuiteSummary = {
  suiteId: string;
  /** The day the suite started, UTC. */
  date: string;
  missions: string[];
  timeoutSeconds: number[];
  versions: {
    claudeCode: string[];
    modelRequested: string[];
    modelUsed: string[];
    /** The agent's thinking effort; one value when every run used the same. */
    effort: string[];
    /** The pinned browser interface of each arm. */
    browserInterfaces: { arm: string; name: string; version: string }[];
    browser: string[];
    aymeCommit: string[];
    formbricksCommit: string[];
  };
  arms: ArmSummary[];
  /** Things a reader must know before trusting the numbers. */
  notes: string[];
};

/** The mean of the two middle values when the count is even. */
export function spread(values: (number | null)[]): Spread | null {
  const present = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const [min] = present;
  const max = present.at(-1);
  if (min === undefined || max === undefined) return null;
  const middle = Math.floor(present.length / 2);
  const median =
    present.length % 2 === 1
      ? present[middle]!
      : (present[middle - 1]! + present[middle]!) / 2;
  return { n: present.length, median, min, max };
}

function distinct<T extends string>(values: (T | null)[]): T[] {
  return [...new Set(values.filter((value): value is T => value !== null))];
}

export function buildSummary(input: {
  suiteId: string;
  date: string;
  /** The order the arms appear in; arms with stored runs but not listed follow. */
  arms: string[];
  /** Runs each arm was asked for, when known. */
  requestedRunsPerArm: number | null;
  results: SummarizedRun[];
}): SuiteSummary {
  const { results } = input;
  const armIds = distinct([...input.arms, ...results.map((r) => r.arm)]);
  const arms: ArmSummary[] = armIds.map((arm) => {
    const runs = results.filter((result) => result.arm === arm);
    return {
      arm,
      runs: runs.length,
      requestedRuns: input.requestedRunsPerArm,
      passes: runs.filter((run) => run.pass).length,
      wallTimeMs: spread(runs.map((run) => run.wallTimeMs)),
      tokens: spread(
        runs.map((run) => (run.tokens ? totalTokens(run.tokens) : null))
      ),
      inputOutputTokens: spread(
        runs.map((run) =>
          run.tokens ? run.tokens.input + run.tokens.output : null
        )
      ),
      toolCalls: spread(runs.map((run) => run.toolCallTotal)),
      combinedCostUsd: spread(runs.map((run) => run.combinedCostUsd)),
      runList: runs.map((run) => ({
        runId: run.runId,
        pass: run.pass,
        wallTimeMs: run.wallTimeMs,
        usage: run.tokens,
        totalTokens: run.tokens ? totalTokens(run.tokens) : null,
        combinedCostUsd: run.combinedCostUsd,
      })),
    };
  });

  const interfaces = new Map<
    string,
    { arm: string; name: string; version: string }
  >();
  for (const { arm, versions } of results) {
    const { name, version } = versions.browserInterface;
    interfaces.set(`${arm}\0${name}\0${version}`, { arm, name, version });
  }

  const versions: SuiteSummary["versions"] = {
    claudeCode: distinct(results.map((r) => r.versions.claudeCode)),
    modelRequested: distinct(results.map((r) => r.versions.model.requested)),
    modelUsed: distinct(results.map((r) => r.versions.model.used)),
    effort: distinct(results.map((r) => r.versions.model.effort ?? null)),
    browserInterfaces: [...interfaces.values()],
    browser: distinct(results.map((r) => r.versions.browser)),
    aymeCommit: distinct(results.map((r) => r.versions.aymeCommit)),
    formbricksCommit: distinct(results.map((r) => r.versions.formbricksCommit)),
  };
  const timeoutSeconds = [...new Set(results.map((r) => r.timeoutSeconds))];

  const notes: string[] = [];
  for (const arm of arms) {
    if (arm.requestedRuns !== null && arm.runs < arm.requestedRuns)
      notes.push(
        `${arm.arm}: ${arm.runs} of ${arm.requestedRuns} requested runs were stored.`
      );
    for (const [label, value] of [
      ["wall time", arm.wallTimeMs],
      ["tokens", arm.tokens],
      ["tool calls", arm.toolCalls],
      ["combined cost", arm.combinedCostUsd],
    ] as const) {
      if (arm.runs > 0 && value !== null && value.n < arm.runs)
        notes.push(
          `${arm.arm}: ${label} is over ${value.n} of ${arm.runs} runs; the others have no data.`
        );
      if (arm.runs > 0 && value === null)
        notes.push(`${arm.arm}: no run has ${label}.`);
    }
    const unknownGoalLoopCost = results.filter(
      (run) =>
        run.arm === arm.arm &&
        run.goalLoop.calls > 0 &&
        run.goalLoop.costUsd === null
    ).length;
    if (unknownGoalLoopCost > 0)
      notes.push(
        `${arm.arm}: the Goal Loop's cost is unknown in ${unknownGoalLoopCost} of ${arm.runs} runs, so their combined cost is unknown.`
      );
  }
  const mixed = [
    ["Claude Code versions", versions.claudeCode],
    ["models", versions.modelUsed],
    ["thinking efforts", versions.effort],
    ["Ayme commits", versions.aymeCommit],
    ["Formbricks commits", versions.formbricksCommit],
    ["timeouts", timeoutSeconds.map(String)],
  ] as const;
  for (const [label, values] of mixed)
    if (values.length > 1)
      notes.push(
        `The runs differ in ${label}: ${values.join(", ")}. A rerun cannot match them all.`
      );
  const dirty = results.filter((run) => run.labCheckoutDirty).length;
  if (dirty > 0)
    notes.push(`${dirty} run(s) changed the lab app checkout while running.`);

  return {
    suiteId: input.suiteId,
    date: input.date,
    missions: distinct(results.map((r) => r.mission)),
    timeoutSeconds,
    versions,
    arms,
    notes,
  };
}

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function range(
  value: Spread | null,
  format: (n: number) => string,
  runs: number
) {
  if (value === null) return "unknown";
  const text = `${format(value.median)} (${format(value.min)} to ${format(value.max)})`;
  return value.n < runs ? `${text}, ${value.n} of ${runs} runs` : text;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const count = (n: number) => integer.format(n);
const dollars = (n: number) => `$${n.toFixed(3)}`;

function list(values: string[]) {
  return values.length === 0 ? "unknown" : values.join(", ");
}

/** The summary as a committed Markdown page. */
export function renderSummaryMarkdown(summary: SuiteSummary) {
  const rows = summary.arms.map((arm) =>
    [
      arm.arm,
      `${arm.passes} of ${arm.runs}`,
      range(arm.wallTimeMs, seconds, arm.runs),
      range(arm.toolCalls, count, arm.runs),
      range(arm.inputOutputTokens, count, arm.runs),
      range(arm.tokens, count, arm.runs),
      range(arm.combinedCostUsd, dollars, arm.runs),
    ].join(" | ")
  );
  const { versions } = summary;
  const lines = [
    `# Formbricks eval summary, ${summary.date}`,
    "",
    `Suite \`${summary.suiteId}\`. Mission: ${list(summary.missions)}. Timeout: ${list(summary.timeoutSeconds.map((s) => `${s} s`))}.`,
    "",
    "Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.",
    "",
    "| Arm | Passes | Wall time | Tool calls | Input and output tokens | All tokens | Combined cost |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    "## Versions a rerun must match",
    "",
    `- Date: ${summary.date}`,
    `- Claude Code: ${list(versions.claudeCode)}`,
    `- Model: ${list(versions.modelUsed)} (requested ${list(versions.modelRequested)}, effort ${list(versions.effort)})`,
    ...versions.browserInterfaces.map(
      ({ arm, name, version }) => `- ${name} ${version} (${arm})`
    ),
    `- Browser: ${list(versions.browser)}`,
    `- Ayme commit: ${list(versions.aymeCommit)}`,
    `- Formbricks commit: ${list(versions.formbricksCommit)}`,
  ];
  if (summary.notes.length > 0)
    lines.push("", "## Notes", "", ...summary.notes.map((note) => `- ${note}`));
  return `${lines.join("\n")}\n`;
}
