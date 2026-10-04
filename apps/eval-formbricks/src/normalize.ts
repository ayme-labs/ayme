import {
  summarizeTranscript,
  type TokenUsage,
  type ToolCallCounts,
} from "./transcript.ts";
import type { Verdict } from "./verdict.ts";

/** What a run leaves behind, before it is turned into a result. */
export type RunArtifacts = {
  runId: string;
  arm: string;
  missionId: string;
  /** The model as requested; the model as used comes from the transcript. */
  requestedModel: string;
  timeoutSeconds: number;
  /** The raw transcript, one stream-json event per line. */
  transcript: string[];
  exitCode: number | null;
  timedOut: boolean;
  /** From the agent's first event to its last, measured by the harness. `null` when no event arrived. */
  wallTimeMs: number | null;
  startedAt: string;
  finishedAt: string;
  verdict: Verdict;
  versions: {
    /** From `claude --version`; the transcript's own report wins when present. */
    claudeCode: string | null;
    browserInterface: { name: string; version: string };
    browser: string | null;
    formbricksCommit: string | null;
    aymeCommit: string | null;
  };
  /** The Goal Loop's own model usage and cost, for arms that run it. Filled by later work. */
  goalLoop: { usage: TokenUsage | null; costUsd: number | null };
  /** Whether the lab app checkout changed during the run. */
  labCheckoutDirty: boolean;
};

export type NormalizedResult = {
  runId: string;
  arm: string;
  mission: string;
  /** The verdict's outcome, from the database alone. */
  pass: boolean;
  verdict: Verdict;
  agent: {
    /** The run ended with a result event, within the timeout, without an error. */
    completed: boolean;
    timedOut: boolean;
    exitCode: number | null;
    isError: boolean;
    numTurns: number | null;
    assistantMessages: number;
    permissionDenials: number;
    finalMessage: string | null;
  };
  wallTimeMs: number | null;
  /** Claude Code's own timing of the run and of its API calls. */
  agentReported: { durationMs: number | null; apiDurationMs: number | null };
  tokens: TokenUsage | null;
  costUsd: number | null;
  goalLoop: { usage: TokenUsage | null; costUsd: number | null };
  /** The agent's cost plus the Goal Loop's where it ran; `null` while the agent's is unknown. */
  combinedCostUsd: number | null;
  toolCalls: ToolCallCounts;
  versions: {
    claudeCode: string | null;
    model: { requested: string; used: string | null };
    browserInterface: { name: string; version: string };
    browser: string | null;
    formbricksCommit: string | null;
    aymeCommit: string | null;
  };
  /** Evidence that nothing beyond the arm's own interface reached the agent. */
  isolation: {
    tools: string[];
    mcpServers: { name: string; status: string }[];
    skills: number;
    plugins: number;
    permissionMode: string | null;
  };
  timeoutSeconds: number;
  startedAt: string;
  finishedAt: string;
  labCheckoutDirty: boolean;
  unparsedTranscriptLines: number;
};

export function normalizeRun(artifacts: RunArtifacts): NormalizedResult {
  const summary = summarizeTranscript(artifacts.transcript);
  const { init, result } = summary;
  const costUsd = result?.costUsd ?? null;
  const modelUsed = result?.modelsUsed[0] ?? init?.model ?? null;
  return {
    runId: artifacts.runId,
    arm: artifacts.arm,
    mission: artifacts.missionId,
    pass: artifacts.verdict.pass,
    verdict: artifacts.verdict,
    agent: {
      completed: !artifacts.timedOut && result !== null && !result.isError,
      timedOut: artifacts.timedOut,
      exitCode: artifacts.exitCode,
      isError: result?.isError ?? false,
      numTurns: result?.numTurns ?? null,
      assistantMessages: summary.assistantMessages,
      permissionDenials: result?.permissionDenials ?? 0,
      finalMessage: result?.finalMessage ?? null,
    },
    wallTimeMs: artifacts.wallTimeMs,
    agentReported: {
      durationMs: result?.durationMs ?? null,
      apiDurationMs: result?.apiDurationMs ?? null,
    },
    tokens: result?.usage ?? null,
    costUsd,
    goalLoop: artifacts.goalLoop,
    combinedCostUsd:
      costUsd === null ? null : costUsd + (artifacts.goalLoop.costUsd ?? 0),
    toolCalls: summary.toolCalls,
    versions: {
      claudeCode: init?.claudeCodeVersion ?? artifacts.versions.claudeCode,
      model: { requested: artifacts.requestedModel, used: modelUsed },
      browserInterface: artifacts.versions.browserInterface,
      browser: artifacts.versions.browser,
      formbricksCommit: artifacts.versions.formbricksCommit,
      aymeCommit: artifacts.versions.aymeCommit,
    },
    isolation: {
      tools: init?.tools ?? [],
      mcpServers: init?.mcpServers ?? [],
      skills: init?.skills ?? 0,
      plugins: init?.plugins ?? 0,
      permissionMode: init?.permissionMode ?? null,
    },
    timeoutSeconds: artifacts.timeoutSeconds,
    startedAt: artifacts.startedAt,
    finishedAt: artifacts.finishedAt,
    labCheckoutDirty: artifacts.labCheckoutDirty,
    unparsedTranscriptLines: summary.unparsedLines,
  };
}

function seconds(ms: number | null) {
  return ms === null ? "unavailable" : `${(ms / 1000).toFixed(1)} s`;
}

function count(value: number | null | undefined) {
  return value ?? "unavailable";
}

/** A short human overview, written next to `result.json`. */
export function summarizeResult(result: NormalizedResult) {
  const tools = Object.entries(result.toolCalls.byTool)
    .map(
      ([name, counts]) =>
        `  - ${name}: ${counts.total} (${counts.failed} failed)`
    )
    .join("\n");
  return `# Run ${result.runId}

- Arm: ${result.arm}
- Mission: ${result.mission}
- Verdict: ${result.pass ? "pass" : "fail"}
- Agent completed: ${result.agent.completed} (timed out: ${result.agent.timedOut}, exit code: ${result.agent.exitCode ?? "none"})
- Wall time: ${seconds(result.wallTimeMs)}
- Input tokens: ${count(result.tokens?.input)}
- Cache creation tokens: ${count(result.tokens?.cacheCreation)}
- Cache read tokens: ${count(result.tokens?.cacheRead)}
- Output tokens: ${count(result.tokens?.output)}
- Cost: ${result.costUsd === null ? "unavailable" : `$${result.costUsd.toFixed(4)}`}
- Combined cost: ${result.combinedCostUsd === null ? "unavailable" : `$${result.combinedCostUsd.toFixed(4)}`}
- Tool calls: ${result.toolCalls.total} (${result.toolCalls.failed} failed)
${tools}
- Permission denials: ${result.agent.permissionDenials}
- Claude Code: ${result.versions.claudeCode ?? "unknown"}
- Model: ${result.versions.model.used ?? "unknown"} (requested ${result.versions.model.requested})
- Browser interface: ${result.versions.browserInterface.name} ${result.versions.browserInterface.version}
- Browser: ${result.versions.browser ?? "unknown"}
- Formbricks: ${result.versions.formbricksCommit ?? "unknown"}
- Ayme: ${result.versions.aymeCommit ?? "unknown"}
- MCP servers: ${result.isolation.mcpServers.map((server) => `${server.name} (${server.status})`).join(", ") || "none"}
- Skills: ${result.isolation.skills}, plugins: ${result.isolation.plugins}
`;
}
