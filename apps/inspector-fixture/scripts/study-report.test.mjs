// study-report's acceptance of a run, on reports written here: no browser,
// no model.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { NotAResult, projectRun } from "./study-report.mjs";

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
