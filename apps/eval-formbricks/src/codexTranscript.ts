/**
 * Reads what `codex app-server` wrote to a run's transcript: one JSON-RPC
 * message per line, the server's answers and notifications. The agent gets
 * one user message per turn and each ends with a `turn/completed`
 * notification, so the messages are split into turns at those. Gives the
 * same summary as a Claude Code transcript, with what Codex does not report
 * left empty: the tools it listed, and any cost.
 */
import type {
  TokenUsage,
  TranscriptInit,
  TranscriptSummary,
  TranscriptTurn,
} from "./transcript.ts";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function parse(line: string): Json | null {
  try {
    const message: unknown = JSON.parse(line);
    return isRecord(message) ? message : null;
  } catch {
    return null;
  }
}

/** Whether one transcript line ends a turn, and whether the turn failed; read while the agent runs. */
export function turnCompleted(line: string): { isError: boolean } | null {
  const message = parse(line);
  if (message?.method !== "turn/completed" || !isRecord(message.params))
    return null;
  const { turn } = message.params;
  return { isError: !isRecord(turn) || turn.status !== "completed" };
}

/** Items that are the conversation itself; every other item is something the agent did, counted as a tool call. */
const conversationItems = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "plan",
  "hookPrompt",
  "contextCompaction",
]);

/** An MCP tool under the name Claude Code gives it, so one summary reads both agents' runs. */
function toolName(item: Json) {
  if (item.type === "mcpToolCall")
    return `mcp__${String(item.server)}__${String(item.tool)}`;
  return String(item.type);
}

type Totals = {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
};

function readTotals(value: unknown): Totals | null {
  if (!isRecord(value)) return null;
  const {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
  } = value;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number")
    return null;
  return {
    input: inputTokens,
    cached: typeof cachedInputTokens === "number" ? cachedInputTokens : 0,
    cacheWrite:
      typeof cacheWriteInputTokens === "number" ? cacheWriteInputTokens : 0,
    output: outputTokens,
  };
}

/**
 * A turn's own tokens: Codex reports the thread's total, so a turn's are the
 * total at its end minus the total before it. Codex counts cached and
 * cache-writing tokens inside the input tokens; Claude Code counts them
 * beside, so they are taken out here.
 */
function turnUsage(atEnd: Totals | null, before: Totals): TokenUsage | null {
  if (atEnd === null) return null;
  const cacheRead = atEnd.cached - before.cached;
  const cacheCreation = atEnd.cacheWrite - before.cacheWrite;
  return {
    input: atEnd.input - before.input - cacheRead - cacheCreation,
    cacheCreation,
    cacheRead,
    output: atEnd.output - before.output,
  };
}

function emptyTurn(): TranscriptTurn {
  return {
    init: null,
    result: null,
    toolCalls: { total: 0, failed: 0, byTool: {} },
    assistantMessages: 0,
  };
}

function sortedCounts(turn: TranscriptTurn): TranscriptTurn["toolCalls"] {
  const entries = Object.entries(turn.toolCalls.byTool).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  return {
    total: entries.reduce((sum, [, counts]) => sum + counts.total, 0),
    failed: entries.reduce((sum, [, counts]) => sum + counts.failed, 0),
    byTool: Object.fromEntries(entries),
  };
}

export function summarizeCodexTranscript(lines: string[]): TranscriptSummary {
  const turns: TranscriptTurn[] = [];
  let unparsedLines = 0;
  let turn = emptyTurn();
  let started = false;
  let finalMessage: string | null = null;
  let model: string | null = null;
  let permissionMode: string | null = null;
  const servers = new Map<string, string>();
  const zero: Totals = { input: 0, cached: 0, cacheWrite: 0, output: 0 };
  let totals: Totals | null = null;
  let totalsBefore = zero;
  /** The tool calls that started and have not finished, by item id. */
  const inFlight = new Map<string, string>();

  const init = (): TranscriptInit => ({
    model,
    claudeCodeVersion: null,
    permissionMode,
    tools: [],
    mcpServers: [...servers].map(([name, status]) => ({ name, status })),
    skills: [],
    plugins: [],
  });

  for (const line of lines) {
    if (!line.trim()) continue;
    const message = parse(line);
    if (message === null) {
      unparsedLines += 1;
      continue;
    }
    // The answer to `thread/start` names the model and approval policy the thread runs with.
    if (isRecord(message.result) && isRecord(message.result.thread)) {
      if (typeof message.result.model === "string")
        model = message.result.model;
      if (typeof message.result.approvalPolicy === "string")
        permissionMode = message.result.approvalPolicy;
    }
    const params = isRecord(message.params) ? message.params : {};
    if (message.method === "mcpServer/startupStatus/updated")
      servers.set(String(params.name), String(params.status));
    if (message.method === "turn/started") started = true;
    if (
      message.method === "thread/tokenUsage/updated" &&
      isRecord(params.tokenUsage)
    )
      totals = readTotals(params.tokenUsage.total) ?? totals;
    if (
      message.method === "item/started" &&
      isRecord(params.item) &&
      typeof params.item.id === "string" &&
      params.item.type !== "agentMessage" &&
      !conversationItems.has(String(params.item.type))
    )
      inFlight.set(params.item.id, toolName(params.item));
    if (message.method === "item/completed" && isRecord(params.item)) {
      const { item } = params;
      if (typeof item.id === "string") inFlight.delete(item.id);
      if (item.type === "agentMessage") {
        turn.assistantMessages += 1;
        if (typeof item.text === "string") finalMessage = item.text;
      } else if (!conversationItems.has(String(item.type))) {
        const counts = (turn.toolCalls.byTool[toolName(item)] ??= {
          total: 0,
          failed: 0,
        });
        counts.total += 1;
        // A command that ran and exited with an error failed as a tool call too.
        if (
          (typeof item.status === "string" && item.status !== "completed") ||
          (typeof item.exitCode === "number" && item.exitCode !== 0)
        )
          counts.failed += 1;
      }
    }
    if (message.method === "turn/completed") {
      const completed = isRecord(params.turn) ? params.turn : {};
      turn.init = init();
      turn.result = {
        isError: completed.status !== "completed",
        subtype: typeof completed.status === "string" ? completed.status : null,
        durationMs:
          typeof completed.durationMs === "number"
            ? completed.durationMs
            : null,
        apiDurationMs: null,
        numTurns: null,
        cumulativeCostUsd: null,
        usage: turnUsage(totals, totalsBefore),
        modelsUsed: model === null ? [] : [model],
        permissionDenials: 0,
        finalMessage,
      };
      turns.push({ ...turn, toolCalls: sortedCounts(turn) });
      turn = emptyTurn();
      started = false;
      finalMessage = null;
      totalsBefore = totals ?? totalsBefore;
      inFlight.clear();
    }
  }
  // Messages after the last completed turn belong to one that was cut short.
  // A tool call it started and never finished was still made, as in a Claude Code transcript.
  if (started) {
    for (const name of inFlight.values())
      (turn.toolCalls.byTool[name] ??= { total: 0, failed: 0 }).total += 1;
  }
  if (started)
    turns.push({ ...turn, init: init(), toolCalls: sortedCounts(turn) });

  return { turns, unparsedLines };
}
