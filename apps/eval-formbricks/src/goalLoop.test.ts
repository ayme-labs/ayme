import { describe, expect, it, vi } from "vitest";

import {
  combinedCost,
  decisionUsageFile,
  lookUpGenerationCosts,
  noGoalLoop,
  parseDecisionUsage,
  selectDecisionUsage,
  summarizeGoalLoop,
  type DecisionUsageRecord,
} from "./goalLoop.ts";

// Lines as the lab app's Decision Endpoint writes them: OpenRouter's usage shape, one per request.
const line = (time: string, overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    time,
    durationMs: 812,
    status: 200,
    requestedModel: "typesafe/jev-1.13",
    model: "typesafe/jev-1.13-20260917",
    generationId: `gen-${time}`,
    usage: { input_tokens: 476, output_tokens: 70, cost: 0 },
    ...overrides,
  });

const usageFile = [
  line("2026-10-04T10:00:00.000Z"),
  line("2026-10-04T10:01:00.000Z"),
  line("2026-10-04T10:02:30.000Z", {
    status: 502,
    model: null,
    generationId: null,
    usage: null,
  }),
  line("2026-10-04T10:03:00.000Z"),
  "not json",
  line("2026-10-04T10:04:00.000Z"),
].join("\n");

const records = parseDecisionUsage(usageFile);
const window = {
  startedAt: "2026-10-04T10:01:00.000Z",
  finishedAt: "2026-10-04T10:03:00.000Z",
};

describe("the usage file", () => {
  it("reads one record per line and skips what is not one", () => {
    expect(records).toHaveLength(5);
    expect(records[0]).toEqual({
      time: "2026-10-04T10:00:00.000Z",
      durationMs: 812,
      status: 200,
      requestedModel: "typesafe/jev-1.13",
      model: "typesafe/jev-1.13-20260917",
      generationId: "gen-2026-10-04T10:00:00.000Z",
      usage: { inputTokens: 476, outputTokens: 70 },
    });
    expect(records[2]).toMatchObject({
      status: 502,
      generationId: null,
      usage: null,
    });
  });

  it("selects a run's lines by its window, bounds included", () => {
    expect(selectDecisionUsage(records, window).map((r) => r.time)).toEqual([
      "2026-10-04T10:01:00.000Z",
      "2026-10-04T10:02:30.000Z",
      "2026-10-04T10:03:00.000Z",
    ]);
  });

  it("is the lab app's default file unless the environment names another", () => {
    expect(decisionUsageFile("/lab/formbricks", {})).toBe(
      "/lab/formbricks/apps/web/.ayme-lab/decision-usage.jsonl"
    );
    expect(
      decisionUsageFile("/lab/formbricks", {
        AYME_LAB_DECISION_USAGE_FILE: "/elsewhere/usage.jsonl",
      })
    ).toBe("/elsewhere/usage.jsonl");
  });
});

describe("the Goal Loop's usage for a run", () => {
  const selected = selectDecisionUsage(records, window);

  it("counts calls and failures and adds up the answered calls' tokens", () => {
    const usage = summarizeGoalLoop(selected, new Map());
    expect(usage.calls).toBe(3);
    expect(usage.failedCalls).toBe(1);
    expect(usage.usage).toEqual({
      input: 952,
      cacheCreation: 0,
      cacheRead: 0,
      output: 140,
    });
  });

  it("adds up the cost when OpenRouter has a record for every answered call", () => {
    const usage = summarizeGoalLoop(
      selected,
      new Map([
        ["gen-2026-10-04T10:01:00.000Z", 0.00002],
        ["gen-2026-10-04T10:03:00.000Z", 0.00003],
      ])
    );
    expect(usage.costUsd).toBeCloseTo(0.00005, 10);
    expect(usage.callsWithCost).toBe(2);
  });

  it("leaves the cost unknown, never zero, when a record is missing", () => {
    const usage = summarizeGoalLoop(
      selected,
      new Map([["gen-2026-10-04T10:01:00.000Z", 0.00002]])
    );
    expect(usage.costUsd).toBeNull();
    expect(usage.callsWithCost).toBe(1);
  });

  it("leaves the cost unknown when a line has no generation id", () => {
    const withoutId: DecisionUsageRecord[] = selected.map((record) => ({
      ...record,
      generationId: null,
    }));
    expect(summarizeGoalLoop(withoutId, new Map()).costUsd).toBeNull();
  });

  it("has no usage without calls", () => {
    expect(summarizeGoalLoop([], new Map())).toEqual(noGoalLoop);
    expect(noGoalLoop).toEqual({
      calls: 0,
      failedCalls: 0,
      usage: null,
      costUsd: null,
      callsWithCost: 0,
    });
  });
});

describe("the combined cost", () => {
  const ran = { ...noGoalLoop, calls: 3, costUsd: 0.1 };

  it("is the agent's cost alone when the Goal Loop made no call", () => {
    expect(combinedCost(0.4321, noGoalLoop)).toBe(0.4321);
  });

  it("adds the Goal Loop's cost when it is known", () => {
    expect(combinedCost(0.4321, ran)).toBeCloseTo(0.5321, 10);
  });

  it("is unknown when the Goal Loop ran and its cost is unknown", () => {
    expect(combinedCost(0.4321, { ...ran, costUsd: null })).toBeNull();
  });

  it("is unknown when the agent's cost is unknown", () => {
    expect(combinedCost(null, noGoalLoop)).toBeNull();
    expect(combinedCost(null, ran)).toBeNull();
  });
});

describe("looking up generation costs", () => {
  const generation = (id: string, total_cost: number) =>
    Response.json({ data: { id, total_cost } });

  it("reads each generation's total cost once, asking a missing one again", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(generation("gen-a", 0.00002))
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(generation("gen-b", 0.00003));
    const costs = await lookUpGenerationCosts(["gen-a", "gen-b", "gen-a"], {
      apiKey: "test-key",
      fetch: fetchMock,
      delayMs: 0,
    });
    expect([...costs]).toEqual([
      ["gen-a", 0.00002],
      ["gen-b", 0.00003],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://openrouter.ai/api/v1/generation?id=gen-a"
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-key"
    );
  });

  it("records an unknown cost when OpenRouter never has the record", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 404 }));
    const log = vi.fn();
    const costs = await lookUpGenerationCosts(["gen-a"], {
      apiKey: "test-key",
      fetch: fetchMock,
      attempts: 2,
      delayMs: 0,
      log,
    });
    expect(costs.get("gen-a")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      "OpenRouter has no cost record for generation gen-a."
    );
  });
});
