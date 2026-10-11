import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  changedLines,
  classify,
  coverageOf,
  crap,
  diffAgainst,
  functionsIn,
  mutateTargets,
  statementCoverage,
} from "./analyze-changed.mjs";

const DIFF = `diff --git a/packages/core/src/a.ts b/packages/core/src/a.ts
--- a/packages/core/src/a.ts
+++ b/packages/core/src/a.ts
@@ -3,0 +4,2 @@ export function a() {
+  if (x) return 1;
+  return 2;
@@ -10 +12 @@
-old
+new
diff --git a/packages/core/src/a.test.ts b/packages/core/src/a.test.ts
--- a/packages/core/src/a.test.ts
+++ b/packages/core/src/a.test.ts
@@ -1,0 +2 @@
+test
`;

test("changedLines keeps added lines of production source only", () => {
  const changes = changedLines(DIFF, [["packages/vue/src/new.ts", 3]]);
  assert.deepEqual(
    [...changes].map(([file, lines]) => [file, [...lines]]),
    [
      ["packages/core/src/a.ts", [4, 5, 12]],
      ["packages/vue/src/new.ts", [1, 2, 3]],
    ]
  );
});

test("functionsIn reports each function's complexity and lines", () => {
  const source = [
    "export function pick(a: boolean, b: boolean) {",
    "  if (a) return 1;",
    "  if (b) return 2;",
    "  return 3;",
    "}",
    "export const id = (x: number) => x;",
  ].join("\n");
  assert.deepEqual(functionsIn(source, "a.ts"), [
    { name: "pick", complexity: 3, start: 1, end: 5 },
    { name: "id", complexity: 1, start: 6, end: 6 },
  ]);
});

test("statementCoverage counts statements inside the function's lines", () => {
  const coverage = {
    statementMap: {
      0: { start: { line: 1 }, end: { line: 1 } },
      1: { start: { line: 2 }, end: { line: 2 } },
      2: { start: { line: 9 }, end: { line: 9 } },
    },
    s: { 0: 1, 1: 0, 2: 0 },
  };
  assert.equal(statementCoverage(coverage, 1, 5), 0.5);
  assert.equal(statementCoverage(undefined, 1, 5), 0);
});

test("crap is complexity alone when fully covered", () => {
  assert.equal(crap(4, 1), 4);
  assert.equal(crap(4, 0), 20);
});

test("classify compares with the base function of the same name", () => {
  const base = [{ name: "pick", complexity: 3 }];
  const fn = (complexity, name = "pick") => ({ name, complexity });
  assert.equal(classify(fn(3), 0, base), "existing");
  assert.equal(classify(fn(4), 0, base), "raised");
  assert.equal(classify(fn(1, "other"), 0, base), "new");
});

test("mutateTargets turns runs of changed lines into ranges", () => {
  const files = new Map([["packages/core/src/a.ts", new Set([4, 5, 6, 12])]]);
  assert.deepEqual(mutateTargets("packages/core", files), [
    "src/a.ts:4-6",
    "src/a.ts:12-12",
  ]);
});

test("changedLines marks where a deletion-only hunk cut lines", () => {
  const diff = `+++ b/packages/core/src/a.ts
@@ -5,2 +4,0 @@ export function a() {
-  if (x) return 1;
-  if (y) return 2;
`;
  assert.deepEqual([...changedLines(diff).get("packages/core/src/a.ts")], [4]);
});

test("changedLines drops scenarios, setups, fixtures and __tests__", () => {
  const diff = [
    "packages/core/src/a.scenario.ts",
    "packages/core/src/a.setup.ts",
    "packages/core/src/fixtures/a.ts",
    "packages/core/src/__tests__/a.ts",
  ]
    .map((file) => `+++ b/${file}\n@@ -0,0 +1 @@\n+x\n`)
    .join("");
  assert.equal(changedLines(diff).size, 0);
});

test("coverageOf finds a file restored from another checkout", () => {
  const entry = { s: {} };
  const coverage = { "/elsewhere/packages/core/src/a.ts": entry };
  assert.equal(coverageOf(coverage, "packages/core/src/a.ts"), entry);
});

test("changedLines reads paths without git's b/ prefix", () => {
  const diff = DIFF.replaceAll(" a/", " ").replaceAll(" b/", " ");
  assert.deepEqual(
    [...changedLines(diff)].map(([file, lines]) => [file, [...lines]]),
    [["packages/core/src/a.ts", [4, 5, 12]]]
  );
});

test("diffAgainst ignores the user's prefix and color config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "analyze-changed-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  const file = path.join(dir, "packages/core/src/a.ts");
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "a\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("config", "diff.noprefix", "true");
    git("config", "diff.mnemonicPrefix", "true");
    git("config", "color.diff", "always");
    fs.writeFileSync(file, "a\nb\n");
    assert.deepEqual(
      [...changedLines(diffAgainst("HEAD", dir))].map(([f, lines]) => [
        f,
        [...lines],
      ]),
      [["packages/core/src/a.ts", [2]]]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
