// study-report's acceptance of a run, on reports written here: no browser,
// no model.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  goalIdentities,
  NotAResult,
  projectRun,
  render,
} from "./study-report.mjs";

const dir = mkdtempSync(join(tmpdir(), "study-report-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const path = join(dir, "report.json");
const key = "pair › opens [chromium]";
const commit = "c0ffee";

/** A one-test goal-arm report whose one step reached the agent. */
function report({ startedAt, status, error, step }) {
  writeFileSync(
    path,
    JSON.stringify({
      run: {
        startedAt,
        status,
        exitCode: status === "passed" ? 0 : 1,
        vcs: { commit },
        errors: [],
        usage: {},
        results: [
          {
            file: "tests/goals/pair.goal.ts",
            titlePath: ["opens"],
            targetId: "chromium",
            status: error ? "failed" : "passed",
            attempts: [
              {
                durationMs: 1000,
                ...(error && { error: { message: error } }),
                steps: [
                  {
                    kind: "agent",
                    label: "open it",
                    source: { line: 3 },
                    ...step,
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  );
}

const measure = (startedAfter, exitCode) =>
  projectRun(path, {
    startedAfter,
    commit,
    exitCode,
    expected: [key],
    shared: [key],
  });

test("a report left at the run's path by an earlier run is not a result", () => {
  report({
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "passed",
    step: {
      status: "passed",
      cache: { mode: "self-finalized" },
      metrics: { modelCalls: 0 },
    },
  });
  assert.throws(
    () => measure(Date.parse("2026-01-02T00:00:00.000Z"), 0),
    (e) => e instanceof NotAResult && /earlier run/.test(e.message)
  );
});

test("a run whose agent turn the provider refused is not a result, though its test only failed", () => {
  const now = Date.now();
  report({
    startedAt: new Date(now + 1).toISOString(),
    status: "failed",
    error:
      "The ACP agent session failed: Internal error: Credit balance is too low",
    step: {
      status: "failed",
      cache: { mode: "missed", reason: "no-entry" },
      metrics: {},
    },
  });
  assert.throws(
    () => measure(now, 1),
    (e) => e instanceof NotAResult && /provider refused/.test(e.message)
  );
});

test("a test that failed is a result, and a handed-off step with no usage is unaccounted, its tokens unknown", () => {
  const now = Date.now();
  report({
    startedAt: new Date(now + 1).toISOString(),
    status: "failed",
    error: "expected the Runs lens to list 2 runs, found 1",
    step: {
      status: "failed",
      cache: { mode: "missed", reason: "no-entry" },
      metrics: {},
    },
  });
  const run = measure(now, 1);
  assert.deepEqual(
    [
      run.shared.passed,
      run.shared.replayed,
      run.shared.modelAnswered,
      run.shared.unaccounted,
      run.shared.tokens,
    ],
    [0, 0, 0, 1, null]
  );
  assert.equal(run.failedTests[0].test, key);
});

test("a goal is its text and literal parameters, at the line of `act`; parameters known only at run time leave it unnamed", () => {
  mkdirSync(join(dir, "tests/goals"), { recursive: true });
  writeFileSync(
    join(dir, "tests/goals/pair.goal.ts"),
    [
      'await agent.act("show the {lens} lens", { params: { lens: "Tools" } });',
      "await agent",
      '  .act("show the {lens} lens", { params: { lens: "Tools" } });',
      'await agent.act("show the {lens} lens", { params: { lens } });',
      'await agent.act("open it");',
    ].join("\n")
  );
  const goals = goalIdentities(dir, "tests/goals");
  const at = (line) => goals.get(`tests/goals/pair.goal.ts:${line}`);
  assert.equal(at(1), 'show the {lens} lens {"lens":"Tools"}');
  assert.equal(at(3), at(1));
  assert.equal(at(4), null);
  assert.equal(at(5), "open it");
});

test("the goals not replayed count a goal once however many tests run it, and a goal unnamed once per use", () => {
  const now = Date.now();
  const step = (line) => ({
    kind: "agent",
    label: "open it",
    status: "passed",
    source: { file: "tests/goals/pair.goal.ts", line },
    cache: { mode: "missed", reason: "no-entry" },
    metrics: { modelCalls: 1 },
    model: { inputTokens: 10, outputTokens: 1 },
  });
  const result = (title, lines) => ({
    file: "tests/goals/pair.goal.ts",
    titlePath: [title],
    targetId: "chromium",
    status: "passed",
    attempts: [{ durationMs: 1000, steps: lines.map(step) }],
  });
  writeFileSync(
    path,
    JSON.stringify({
      run: {
        startedAt: new Date(now + 1).toISOString(),
        status: "passed",
        exitCode: 0,
        vcs: { commit },
        errors: [],
        usage: {},
        results: [result("one", [1, 4]), result("two", [1, 4])],
      },
    })
  );
  const keys = ["pair › one [chromium]", "pair › two [chromium]"];
  const run = projectRun(path, {
    startedAfter: now,
    commit,
    exitCode: 0,
    expected: keys,
    shared: keys,
    goals: new Map([
      ["tests/goals/pair.goal.ts:1", "open it"],
      ["tests/goals/pair.goal.ts:4", null],
    ]),
  });
  assert.deepEqual(run.notReplayedGoals, { steps: 4, distinct: 3, perUse: 2 });
});

test("the page shows the arms measured on the latest arm's tests, and names the others instead of failing", () => {
  const arm = (id, digest, startedAt) => ({
    arm: id,
    name: `Arm ${id}`,
    commit,
    cohort: { shared: 1, others: 0, digest },
    runs: [
      {
        startedAt,
        estimatedCostUsd: 0,
        commandWallMs: 1000,
        loadAverage: [1, 1, 1],
        shared: { passed: 1, tests: 1, testMs: 1000 },
        notReplayed: [],
        notReplayedGoals: { steps: 0, distinct: 0, perUse: 0 },
        failedTests: [],
      },
    ],
  });
  const page = render(
    [arm("arm2", "old", "2026-01-01"), arm("arm2b", "new", "2026-01-02")],
    "arm2b"
  );
  assert.match(page, /\| Arm arm2b \|/);
  assert.doesNotMatch(page, /\| Arm arm2 \|/);
  assert.match(page, /not shown until they are measured again: Arm arm2\./);
});
