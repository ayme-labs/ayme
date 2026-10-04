/**
 * Reads a Claude Code `--output-format stream-json --verbose` transcript: one
 * JSON event per line. Pulls out what the result needs and nothing more.
 */

export type TokenUsage = {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
};

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
  skills: number;
  plugins: number;
};

export type TranscriptResult = {
  isError: boolean;
  subtype: string | null;
  durationMs: number | null;
  apiDurationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
  usage: TokenUsage | null;
  modelsUsed: string[];
  permissionDenials: number;
  finalMessage: string | null;
};

export type TranscriptSummary = {
  /** The `system/init` event; `null` when the run never got that far. */
  init: TranscriptInit | null;
  /** The `result` event; `null` when the run ended without one, such as a timeout. */
  result: TranscriptResult | null;
  toolCalls: ToolCallCounts;
  assistantMessages: number;
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
    skills: Array.isArray(event.skills) ? event.skills.length : 0,
    plugins: Array.isArray(event.plugins) ? event.plugins.length : 0,
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
    costUsd: numberOrNull(event.total_cost_usd),
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

export function summarizeTranscript(lines: string[]): TranscriptSummary {
  const { events, unparsedLines } = parseEvents(lines);
  let init: TranscriptInit | null = null;
  let result: TranscriptResult | null = null;
  let assistantMessages = 0;
  const toolNames = new Map<string, string>();
  const byTool: ToolCallCounts["byTool"] = {};

  for (const event of events) {
    if (event.type === "system" && event.subtype === "init")
      init = readInit(event);
    if (event.type === "result") result = readResult(event);
    if (event.type === "assistant") {
      assistantMessages += 1;
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_use") continue;
        const name = stringOrNull(block.name) ?? "unknown";
        const id = stringOrNull(block.id);
        if (id !== null) toolNames.set(id, name);
        const counts = (byTool[name] ??= { total: 0, failed: 0 });
        counts.total += 1;
      }
    }
    if (event.type === "user") {
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_result" || block.is_error !== true) continue;
        const id = stringOrNull(block.tool_use_id);
        const name = (id !== null && toolNames.get(id)) || "unknown";
        const counts = (byTool[name] ??= { total: 0, failed: 0 });
        counts.failed += 1;
      }
    }
  }

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
  return {
    init,
    result,
    toolCalls: { total, failed, byTool: sorted },
    assistantMessages,
    unparsedLines,
  };
}
