// study-report's acceptance of a run, on reports written here: no browser,
// no model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";

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

/** A one-test goal-arm report with one step; `error` is e2e's structured error of its attempt. */
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
                ...(error && { error }),
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

test("a run with an error e2e does not class as a test failure is not a result, though its test only failed", () => {
  const now = Date.now();
  report({
    startedAt: new Date(now + 1).toISOString(),
    status: "failed",
    error: {
      category: "infrastructure",
      code: "MODEL_PROVIDER_FAILED",
      message: "The ACP agent did not start: spawn claude-agent-acp ENOENT",
      retryable: false,
    },
    step: { status: "failed", cache: { mode: "missed", reason: "no-entry" } },
  });
  assert.throws(
    () => measure(now, 1),
    (e) => e instanceof NotAResult && /MODEL_PROVIDER_FAILED/.test(e.message)
  );
});

test("a test that failed is a result, and a step that failed after a model call reached the model, its usage unknown without the provider's count", () => {
  const now = Date.now();
  report({
    startedAt: new Date(now + 1).toISOString(),
    status: "failed",
    error: {
      category: "test",
      code: "ASSERTION_FAILED",
      message: "expected the Runs lens to list 2 runs, found 1",
      retryable: false,
    },
    step: {
      status: "failed",
      cache: { mode: "missed", reason: "no-entry" },
      metrics: { modelCalls: 1 },
      // What e2e writes when the ACP agent reported no usage.
      model: {
        tokenAccounting: "adapter-upper-bound",
        inputTokens: 0,
        outputTokens: 0,
      },
    },
  });
  const run = measure(now, 1);
  const {
    passed,
    replayed,
    reachedModel,
    reachedModelFailed,
    neither,
    tokens,
  } = run.shared;
  assert.deepEqual(
    [passed, replayed, reachedModel, reachedModelFailed, neither, tokens],
    [0, 0, 1, 1, 0, null]
  );
  assert.equal(run.notReplayed[0].tokens, null);
  assert.equal(run.failedTests[0].test, key);
  // With no cost estimate from e2e, the page does not claim $0.00.
  const page = render([
    {
      arm: "arm1",
      name: "Arm one",
      commit,
      cohort: { shared: 1, others: 0, digest: "d" },
      runs: [{ ...run, commandWallMs: 1000, loadAverage: [1, 1, 1] }],
    },
  ]);
  assert.match(page, /^\| Arm one \|.*\| unknown \| unknown \|$/m);
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
      'await agent.act("show the {lens} lens", { params: { "lens": "Tools" } });',
    ].join("\n")
  );
  const goals = goalIdentities(dir, "tests/goals");
  const at = (line) => goals.get(`tests/goals/pair.goal.ts:${line}`);
  assert.equal(at(1), 'show the {lens} lens {"lens":"Tools"}');
  assert.equal(at(3), at(1));
  assert.equal(at(4), null);
  assert.equal(at(5), "open it");
  assert.equal(at(6), at(1));
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

test("the page's count of arm 2's own tests is arm 2's result's, whatever a goal arm's file says", () => {
  const run = (others) => ({
    startedAt: "2026-01-01",
    estimatedCostUsd: null,
    commandWallMs: 1000,
    loadAverage: [1, 1, 1],
    shared: { passed: 1, tests: 1, testMs: 1000, modelCalls: 0 },
    ...(others && { others: { passed: others, tests: others, testMs: 1 } }),
    notReplayed: [],
    notReplayedGoals: { steps: 0, distinct: 0, perUse: 0 },
    failedTests: [],
  });
  const arm = (id, others) => ({
    arm: id,
    name: id,
    commit,
    cohort: { shared: 1, others: 13, digest: "same" },
    runs: [run(others)],
  });
  const page = render([arm("arm1"), arm("arm2", 42)], "arm2");
  assert.match(page, /and 42 more of arm 2's own, 43 in arm 2\./);
});

const script = fileURLToPath(new URL("study-baseline.mjs", import.meta.url));
/** The harness as a command, outside CI (which it refuses), with `env` over this process's. */
const harness = (args, env) => {
  const all = { ...process.env, ...env };
  delete all.CI;
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: all,
  });
};

test("arms 1 and 2 refuse a NODE_OPTIONS that preloads a module, such as the patch hook, before anything runs", () => {
  const hook = join(dir, "patched-e2e/register.mjs");
  mkdirSync(join(dir, "patched-e2e"), { recursive: true });
  writeFileSync(hook, "");
  for (const arm of ["arm1", "arm2"]) {
    // AYME_E2E_DEBUG stops the harness at its next guard, should this one miss.
    const { status, stderr } = harness([arm], {
      NODE_OPTIONS: `--import ${hook}`,
      AYME_E2E_DEBUG: "1",
    });
    assert.equal(status, 2);
    assert.match(stderr, /unset NODE_OPTIONS: arm[12] runs e2e as published/);
  }
});

test("render exits non-zero and leaves the page as it was when the formatter fails", () => {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "pnpm"), 0o755);
  const page = fileURLToPath(
    new URL("../study/baseline/README.md", import.meta.url)
  );
  const before = readFileSync(page, "utf8");
  const { status } = harness(["render"], { PATH: bin });
  assert.notEqual(status, 0);
  assert.equal(readFileSync(page, "utf8"), before);
});
