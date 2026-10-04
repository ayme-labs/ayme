/**
 * The Goal Loop's own model usage for a run. The lab app's Decision Endpoint
 * appends one JSON line per decision request to a usage file that lives for
 * the lab app's lifetime, so a run's calls are the lines whose time falls in
 * the run's window. Token counts come from those lines. Cost comes from
 * OpenRouter's own record of each generation; a call without one has an
 * unknown cost, never a cost of zero.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { TokenUsage } from "./transcript.ts";

export const decisionUsageFileVariable = "AYME_LAB_DECISION_USAGE_FILE";

/** The lab app's default, relative to the Formbricks checkout; `AYME_LAB_DECISION_USAGE_FILE` names another. */
export function decisionUsageFile(
  formbricksRoot: string,
  environment: NodeJS.ProcessEnv = process.env
) {
  return (
    environment[decisionUsageFileVariable] ||
    path.join(formbricksRoot, "apps/web/.ayme-lab/decision-usage.jsonl")
  );
}

/** One line of the usage file, as the lab app writes it. */
export type DecisionUsageRecord = {
  time: string;
  durationMs: number | null;
  /** The Decision Endpoint's response status; 200 is a decision the model answered. */
  status: number | null;
  requestedModel: string | null;
  model: string | null;
  /** OpenRouter's id for the generation, the key to its cost record. */
  generationId: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
};

export type GoalLoopUsage = {
  /** Decision requests the lab app forwarded during the run. */
  calls: number;
  /** Of those, the ones the model did not answer. */
  failedCalls: number;
  /** Input and output tokens of the answered calls; the Goal Loop's model has no cache tokens. `null` without calls. */
  usage: TokenUsage | null;
  /** The answered calls' cost from OpenRouter's generation records; `null` when any is missing, or without calls. */
  costUsd: number | null;
  /** Answered calls whose generation record was found. */
  callsWithCost: number;
};

export const noGoalLoop: GoalLoopUsage = {
  calls: 0,
  failedCalls: 0,
  usage: null,
  costUsd: null,
  callsWithCost: 0,
};

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown) =>
  typeof value === "string" ? value : null;

/** Reads the usage file's lines; a line that is not a record with a time is skipped. */
export function parseDecisionUsage(text: string): DecisionUsageRecord[] {
  const records: DecisionUsageRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value) || typeof value.time !== "string") continue;
    const usage = isRecord(value.usage) ? value.usage : null;
    const inputTokens = numberOrNull(usage?.input_tokens);
    const outputTokens = numberOrNull(usage?.output_tokens);
    records.push({
      time: value.time,
      durationMs: numberOrNull(value.durationMs),
      status: numberOrNull(value.status),
      requestedModel: stringOrNull(value.requestedModel),
      model: stringOrNull(value.model),
      generationId: stringOrNull(value.generationId),
      usage:
        inputTokens === null || outputTokens === null
          ? null
          : { inputTokens, outputTokens },
    });
  }
  return records;
}

/** The records whose time falls within the window, bounds included. */
export function selectDecisionUsage(
  records: DecisionUsageRecord[],
  window: { startedAt: string; finishedAt: string }
): DecisionUsageRecord[] {
  const start = Date.parse(window.startedAt);
  const end = Date.parse(window.finishedAt);
  return records.filter((record) => {
    const time = Date.parse(record.time);
    return Number.isFinite(time) && time >= start && time <= end;
  });
}

const answered = (record: DecisionUsageRecord) => record.status === 200;

/**
 * The run's Goal Loop usage from its records and the cost OpenRouter reports
 * for each generation id (`null` when it reports none).
 */
export function summarizeGoalLoop(
  records: DecisionUsageRecord[],
  costByGenerationId: ReadonlyMap<string, number | null>
): GoalLoopUsage {
  if (records.length === 0) return noGoalLoop;
  const usage: TokenUsage = {
    input: 0,
    cacheCreation: 0,
    cacheRead: 0,
    output: 0,
  };
  let failedCalls = 0;
  let callsWithCost = 0;
  let costUsd: number | null = 0;
  for (const record of records) {
    if (!answered(record)) {
      failedCalls += 1;
      continue;
    }
    usage.input += record.usage?.inputTokens ?? 0;
    usage.output += record.usage?.outputTokens ?? 0;
    const cost =
      record.generationId === null
        ? null
        : (costByGenerationId.get(record.generationId) ?? null);
    if (cost === null) costUsd = null;
    else {
      callsWithCost += 1;
      if (costUsd !== null) costUsd += cost;
    }
  }
  return {
    calls: records.length,
    failedCalls,
    usage,
    costUsd: records.length === failedCalls ? null : costUsd,
    callsWithCost,
  };
}

/**
 * The agent's cost plus the Goal Loop's. Unknown (`null`) while the agent's
 * is, or while the Goal Loop ran and its cost is unknown; the agent's cost
 * alone when the Goal Loop made no call.
 */
export function combinedCost(
  agentCostUsd: number | null,
  goalLoop: GoalLoopUsage
): number | null {
  if (agentCostUsd === null) return null;
  if (goalLoop.calls === 0) return agentCostUsd;
  if (goalLoop.costUsd === null) return null;
  return agentCostUsd + goalLoop.costUsd;
}

/** The lines of the usage file; none when the lab app has not written one. */
export async function readDecisionUsage(
  file: string
): Promise<DecisionUsageRecord[]> {
  try {
    return parseDecisionUsage(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export const generationEndpoint = "https://openrouter.ai/api/v1/generation";

/**
 * OpenRouter's cost for each generation, from its generation endpoint. A
 * record can lag the response, so a missing one is asked for again a few
 * times before it counts as unknown.
 */
export async function lookUpGenerationCosts(
  generationIds: string[],
  options: {
    apiKey: string;
    fetch?: typeof fetch;
    attempts?: number;
    delayMs?: number;
    log?: (line: string) => void;
  }
): Promise<Map<string, number | null>> {
  const {
    apiKey,
    fetch: fetchFn = fetch,
    attempts = 4,
    delayMs = 3_000,
    log = () => undefined,
  } = options;
  const costs = new Map<string, number | null>();
  for (const id of new Set(generationIds)) {
    let cost: number | null = null;
    for (let attempt = 1; attempt <= attempts && cost === null; attempt += 1) {
      if (attempt > 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      const response = await fetchFn(
        `${generationEndpoint}?id=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (response.status === 404) continue;
      if (!response.ok) {
        log(
          `OpenRouter answered HTTP ${response.status} for generation ${id}; its cost is unknown.`
        );
        break;
      }
      const body: unknown = await response.json();
      const data = isRecord(body) && isRecord(body.data) ? body.data : null;
      cost = numberOrNull(data?.total_cost);
      if (cost === null) break;
    }
    if (cost === null)
      log(`OpenRouter has no cost record for generation ${id}.`);
    costs.set(id, cost);
  }
  return costs;
}

/**
 * The Goal Loop's usage for one run: the usage file's lines within the run's
 * window, with each answered call's cost looked up at OpenRouter when a key is
 * at hand. Without a key every cost is unknown.
 */
export async function measureGoalLoop(options: {
  usageFile: string;
  window: { startedAt: string; finishedAt: string };
  openRouterApiKey: string | undefined;
  log: (line: string) => void;
}): Promise<GoalLoopUsage> {
  const records = selectDecisionUsage(
    await readDecisionUsage(options.usageFile),
    options.window
  );
  if (records.length === 0) return noGoalLoop;
  const generationIds = records
    .filter(answered)
    .map((record) => record.generationId)
    .filter((id): id is string => id !== null);
  let costs = new Map<string, number | null>();
  if (options.openRouterApiKey === undefined)
    options.log(
      "No AYME_OPENROUTER_API_KEY in the eval's environment, so the Goal Loop's cost is unknown."
    );
  else
    costs = await lookUpGenerationCosts(generationIds, {
      apiKey: options.openRouterApiKey,
      log: options.log,
    });
  return summarizeGoalLoop(records, costs);
}
