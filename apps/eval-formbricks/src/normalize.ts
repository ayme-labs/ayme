import type { Turn } from "./claude.ts";
import { combinedCost, type GoalLoopUsage } from "./goalLoop.ts";
import {
  summarizeTranscript,
  totalTokens,
  type TokenUsage,
  type ToolCallCounts,
  type TranscriptTurn,
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
  /** The raw transcript, one stream-json event per line: the setup turn's events, then the task turn's. */
  transcript: string[];
  exitCode: number | null;
  /** The setup turn's timing, measured by the harness. It completed, or the run could not. */
  setupTurn: Turn;
  /** The task turn's timing, measured by the harness. */
  taskTurn: Turn;
  /** When the agent's process ended. */
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
  /** The Goal Loop's own model calls, tokens and cost during the run; no calls for arms without it. */
  goalLoop: GoalLoopUsage;
  /** What the arm's setup established before the measured window, such as the page paired with the Ayme MCP server; `null` for arms without a setup. */
  setup: Record<string, unknown> | null;
  /** What the agent changed in the lab app folder during the run. */
  labCheckout: {
    /** Files it created there, moved into the run folder's `agent-files/`. */
    movedFiles: string[];
    /** Tracked files it modified, left in place. */
    modifiedFiles: string[];
  };
};

export type NormalizedResult = {
  runId: string;
  arm: string;
  mission: string;
  /** The verdict's outcome, from the database alone. */
  pass: boolean;
  verdict: Verdict;
  /** The task turn: everything from the task message on. */
  agent: {
    /** The task turn ended with a result event, within the timeout, without an error. */
    completed: boolean;
    timedOut: boolean;
    exitCode: number | null;
    isError: boolean;
    numTurns: number | null;
    assistantMessages: number;
    permissionDenials: number;
    finalMessage: string | null;
  };
  /** From sending the task message to its result event. */
  wallTimeMs: number | null;
  /** Claude Code's own timing of the task turn and of its API calls. */
  agentReported: { durationMs: number | null; apiDurationMs: number | null };
  /** The task turn's tokens. */
  tokens: TokenUsage | null;
  /** The task turn's cost: the session's cumulative cost at its end minus the setup turn's. */
  costUsd: number | null;
  goalLoop: GoalLoopUsage;
  /** The agent's cost plus the Goal Loop's where it ran; `null` while either is unknown. */
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
    skills: string[];
    plugins: { name: string; source: string | null }[];
    permissionMode: string | null;
  };
  setup: Record<string, unknown> | null;
  /**
   * The setup turn, before the task message: Claude Code's start-up and the
   * arm's skill load. Kept apart; never added to the figures above.
   */
  setupTurn: {
    /** When the agent was started and the setup message sent. */
    sentAt: string;
    wallTimeMs: number | null;
    agentReported: { durationMs: number | null; apiDurationMs: number | null };
    tokens: TokenUsage | null;
    costUsd: number | null;
    numTurns: number | null;
    toolCalls: ToolCallCounts;
    finalMessage: string | null;
  };
  timeoutSeconds: number;
  /** When the task message was sent: the start of the measured window. */
  startedAt: string;
  /** When the agent's process ended. */
  finishedAt: string;
  labCheckoutDirty: boolean;
  labCheckout: RunArtifacts["labCheckout"];
  unparsedTranscriptLines: number;
};

const noTurn: TranscriptTurn = {
  init: null,
  result: null,
  toolCalls: { total: 0, failed: 0, byTool: {} },
  assistantMessages: 0,
};

/** Claude Code's cost is cumulative over the session; a turn's own is the difference, free of float noise. */
function turnCost(
  cumulativeAtEnd: number | null,
  cumulativeBefore: number | null
) {
  if (cumulativeAtEnd === null || cumulativeBefore === null) return null;
  return Math.round((cumulativeAtEnd - cumulativeBefore) * 1e10) / 1e10;
}

export function normalizeRun(artifacts: RunArtifacts): NormalizedResult {
  const summary = summarizeTranscript(artifacts.transcript);
  // The setup message is answered first; everything after its result event is the task turn's.
  const [setup = noTurn, task = noTurn] = summary.turns;
  const { result } = task;
  const init = task.init ?? setup.init;
  const costUsd = turnCost(
    result?.cumulativeCostUsd ?? null,
    setup.result?.cumulativeCostUsd ?? null
  );
  // modelUsage can list helper models too, in no defined order; the session's model comes first.
  const modelUsed =
    init?.model ??
    (result?.modelsUsed.length === 1 ? result.modelsUsed[0] : null) ??
    null;
  return {
    runId: artifacts.runId,
    arm: artifacts.arm,
    mission: artifacts.missionId,
    pass: artifacts.verdict.pass,
    verdict: artifacts.verdict,
    agent: {
      completed:
        !artifacts.taskTurn.timedOut && result !== null && !result.isError,
      timedOut: artifacts.taskTurn.timedOut,
      exitCode: artifacts.exitCode,
      isError: result?.isError ?? false,
      numTurns: result?.numTurns ?? null,
      assistantMessages: task.assistantMessages,
      permissionDenials: result?.permissionDenials ?? 0,
      finalMessage: result?.finalMessage ?? null,
    },
    wallTimeMs: artifacts.taskTurn.wallTimeMs,
    agentReported: {
      durationMs: result?.durationMs ?? null,
      apiDurationMs: result?.apiDurationMs ?? null,
    },
    tokens: result?.usage ?? null,
    costUsd,
    goalLoop: artifacts.goalLoop,
    combinedCostUsd: combinedCost(costUsd, artifacts.goalLoop),
    toolCalls: task.toolCalls,
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
      skills: init?.skills ?? [],
      plugins: init?.plugins ?? [],
      permissionMode: init?.permissionMode ?? null,
    },
    setup: artifacts.setup,
    setupTurn: {
      sentAt: artifacts.setupTurn.sentAt,
      wallTimeMs: artifacts.setupTurn.wallTimeMs,
      agentReported: {
        durationMs: setup.result?.durationMs ?? null,
        apiDurationMs: setup.result?.apiDurationMs ?? null,
      },
      tokens: setup.result?.usage ?? null,
      costUsd: setup.result?.cumulativeCostUsd ?? null,
      numTurns: setup.result?.numTurns ?? null,
      toolCalls: setup.toolCalls,
      finalMessage: setup.result?.finalMessage ?? null,
    },
    timeoutSeconds: artifacts.timeoutSeconds,
    startedAt: artifacts.taskTurn.sentAt,
    finishedAt: artifacts.finishedAt,
    labCheckoutDirty:
      artifacts.labCheckout.movedFiles.length > 0 ||
      artifacts.labCheckout.modifiedFiles.length > 0,
    labCheckout: artifacts.labCheckout,
    unparsedTranscriptLines: summary.unparsedLines,
  };
}

function seconds(ms: number | null) {
  return ms === null ? "unknown" : `${(ms / 1000).toFixed(1)} s`;
}

function count(value: number | null | undefined) {
  return value ?? "unknown";
}

function dollars(value: number | null) {
  return value === null ? "unknown" : `$${value.toFixed(4)}`;
}

/** A short human overview, written next to `result.json`. */
export function summarizeResult(result: NormalizedResult) {
  const tools = Object.entries(result.toolCalls.byTool)
    .map(
      ([name, counts]) =>
        `  - ${name}: ${counts.total} (${counts.failed} failed)`
    )
    .join("\n");
  const { goalLoop, setupTurn } = result;
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
- Cost: ${dollars(result.costUsd)}
- Goal Loop calls: ${goalLoop.calls} (${goalLoop.failedCalls} failed)
- Goal Loop tokens: ${goalLoop.usage === null ? "none" : `${goalLoop.usage.input} in, ${goalLoop.usage.output} out`}
- Goal Loop cost: ${goalLoop.calls === 0 ? "none" : dollars(goalLoop.costUsd)}
- Combined cost: ${dollars(result.combinedCostUsd)}
- Tool calls: ${result.toolCalls.total} (${result.toolCalls.failed} failed)
${tools}
- Permission denials: ${result.agent.permissionDenials}
- Setup turn, not counted above: ${seconds(setupTurn.wallTimeMs)}, ${count(setupTurn.tokens === null ? null : totalTokens(setupTurn.tokens))} tokens, ${dollars(setupTurn.costUsd)}, tool calls ${setupTurn.toolCalls.total} (${setupTurn.toolCalls.failed} failed)
- Claude Code: ${result.versions.claudeCode ?? "unknown"}
- Model: ${result.versions.model.used ?? "unknown"} (requested ${result.versions.model.requested})
- Browser interface: ${result.versions.browserInterface.name} ${result.versions.browserInterface.version}
- Browser: ${result.versions.browser ?? "unknown"}
- Formbricks: ${result.versions.formbricksCommit ?? "unknown"}
- Ayme: ${result.versions.aymeCommit ?? "unknown"}
- MCP servers: ${result.isolation.mcpServers.map((server) => `${server.name} (${server.status})`).join(", ") || "none"}
- Skills: ${result.isolation.skills.join(", ") || "none"}
- Plugins: ${result.isolation.plugins.map((plugin) => plugin.source ?? plugin.name).join(", ") || "none"}
`;
}
