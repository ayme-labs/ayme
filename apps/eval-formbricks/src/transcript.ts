/**
 * Reads a Claude Code `--output-format stream-json --verbose` transcript: one
 * JSON event per line. The agent gets one user message per turn and answers
 * each with its own `result` event, so the events are split into turns at
 * those. Pulls out what the result needs and nothing more.
 */

export type TokenUsage = {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
};

/** Input, cache creation, cache read and output tokens added up. */
export function totalTokens(usage: TokenUsage) {
  return usage.input + usage.cacheCreation + usage.cacheRead + usage.output;
}

export type ToolCallCounts = {
  total: number;
  failed: number;
  byTool: Record<string, { total: number; failed: number }>;
};

export type TranscriptInit = {
  model: string | null;
  claudeCodeVersion: string | null;
  permissionMode: string | null;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  skills: string[];
  plugins: { name: string; source: string | null }[];
};

export type TranscriptResult = {
  isError: boolean;
  subtype: string | null;
  durationMs: number | null;
  apiDurationMs: number | null;
  numTurns: number | null;
  /** `total_cost_usd`, which Claude Code accumulates over the session's turns. */
  cumulativeCostUsd: number | null;
  /** This turn's usage alone. */
  usage: TokenUsage | null;
  modelsUsed: string[];
  permissionDenials: number;
  finalMessage: string | null;
};

/** One user message and everything the agent did until its `result` event. */
export type TranscriptTurn = {
  /** The `system/init` event Claude Code emits before each turn; `null` when the turn never got that far. */
  init: TranscriptInit | null;
  /** The `result` event; `null` when the turn ended without one, such as a timeout. */
  result: TranscriptResult | null;
  toolCalls: ToolCallCounts;
  assistantMessages: number;
};

export type TranscriptSummary = {
  /** In order; the last turn has no result when the run was stopped during it. */
  turns: TranscriptTurn[];
  unparsedLines: number;
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseEvents(lines: string[]) {
  const events: Json[] = [];
  let unparsedLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isRecord(event)) events.push(event);
      else unparsedLines += 1;
    } catch {
      unparsedLines += 1;
    }
  }
  return { events, unparsedLines };
}

/** Whether one transcript line is a `result` event, and whether it reports an error; read while the agent runs. */
export function resultEvent(line: string): { isError: boolean } | null {
  try {
    const event: unknown = JSON.parse(line);
    if (!isRecord(event) || event.type !== "result") return null;
    return { isError: event.is_error === true };
  } catch {
    return null;
  }
}

function readInit(event: Json): TranscriptInit {
  const mcpServers = Array.isArray(event.mcp_servers)
    ? event.mcp_servers.filter(isRecord).map((server) => ({
        name: stringOrNull(server.name) ?? "",
        status: stringOrNull(server.status) ?? "",
      }))
    : [];
  return {
    model: stringOrNull(event.model),
    claudeCodeVersion: stringOrNull(event.claude_code_version),
    permissionMode: stringOrNull(event.permissionMode),
    tools: Array.isArray(event.tools)
      ? event.tools.filter((tool) => typeof tool === "string")
      : [],
    mcpServers,
    skills: Array.isArray(event.skills)
      ? event.skills
          .map(skillName)
          .filter((name): name is string => name !== null)
      : [],
    plugins: Array.isArray(event.plugins)
      ? event.plugins.filter(isRecord).map((plugin) => ({
          name: stringOrNull(plugin.name) ?? "",
          source: stringOrNull(plugin.source),
        }))
      : [],
  };
}

function readUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) return null;
  const input = numberOrNull(value.input_tokens);
  const output = numberOrNull(value.output_tokens);
  if (input === null || output === null) return null;
  return {
    input,
    cacheCreation: numberOrNull(value.cache_creation_input_tokens) ?? 0,
    cacheRead: numberOrNull(value.cache_read_input_tokens) ?? 0,
    output,
  };
}

function readResult(event: Json): TranscriptResult {
  return {
    isError: event.is_error === true,
    subtype: stringOrNull(event.subtype),
    durationMs: numberOrNull(event.duration_ms),
    apiDurationMs: numberOrNull(event.duration_api_ms),
    numTurns: numberOrNull(event.num_turns),
    cumulativeCostUsd: numberOrNull(event.total_cost_usd),
    usage: readUsage(event.usage),
    modelsUsed: isRecord(event.modelUsage) ? Object.keys(event.modelUsage) : [],
    permissionDenials: Array.isArray(event.permission_denials)
      ? event.permission_denials.length
      : 0,
    finalMessage: stringOrNull(event.result),
  };
}

function contentBlocks(event: Json): Json[] {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord);
}

function emptyTurn(): TranscriptTurn {
  return {
    init: null,
    result: null,
    toolCalls: { total: 0, failed: 0, byTool: {} },
    assistantMessages: 0,
  };
}

function sortedCounts(turn: TranscriptTurn): ToolCallCounts {
  const { byTool } = turn.toolCalls;
  const sorted = Object.fromEntries(
    Object.entries(byTool).sort(([left], [right]) => left.localeCompare(right))
  );
  const total = Object.values(byTool).reduce(
    (sum, counts) => sum + counts.total,
    0
  );
  const failed = Object.values(byTool).reduce(
    (sum, counts) => sum + counts.failed,
    0
  );
  return { total, failed, byTool: sorted };
}

export function summarizeTranscript(lines: string[]): TranscriptSummary {
  const { events, unparsedLines } = parseEvents(lines);
  const turns: TranscriptTurn[] = [];
  let turn = emptyTurn();
  let started = false;
  const toolNames = new Map<string, string>();

  for (const event of events) {
    started = true;
    if (event.type === "system" && event.subtype === "init")
      turn.init = readInit(event);
    if (event.type === "assistant") {
      turn.assistantMessages += 1;
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_use") continue;
        const name = stringOrNull(block.name) ?? "unknown";
        const id = stringOrNull(block.id);
        if (id !== null) toolNames.set(id, name);
        const counts = (turn.toolCalls.byTool[name] ??= {
          total: 0,
          failed: 0,
        });
        counts.total += 1;
      }
    }
    if (event.type === "user") {
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_result" || block.is_error !== true) continue;
        const id = stringOrNull(block.tool_use_id);
        const name = (id !== null && toolNames.get(id)) || "unknown";
        const counts = (turn.toolCalls.byTool[name] ??= {
          total: 0,
          failed: 0,
        });
        counts.failed += 1;
      }
    }
    if (event.type === "result") {
      turn.result = readResult(event);
      turns.push({ ...turn, toolCalls: sortedCounts(turn) });
      turn = emptyTurn();
      started = false;
    }
  }
  // Events after the last result belong to a turn that was cut short.
  if (started) turns.push({ ...turn, toolCalls: sortedCounts(turn) });

  return { turns, unparsedLines };
}

/** The init event lists skills as names or as objects with a name. */
function skillName(skill: unknown): string | null {
  if (typeof skill === "string") return skill;
  return isRecord(skill) ? stringOrNull(skill.name) : null;
}
