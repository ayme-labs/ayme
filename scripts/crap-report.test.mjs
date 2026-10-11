import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { scorePackage } from "./crap-report.mjs";

test("scorePackage reads a restored report's files from this checkout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crap-report-"));
  const file = "packages/core/src/a.ts";
  try {
    fs.mkdirSync(path.join(root, "packages/core/src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, file),
      "export function pick(a: boolean) {\n  if (a) return 1;\n  return 2;\n}\n"
    );
    const coverage = {
      [`/elsewhere/checkout/${file}`]: {
        statementMap: { 0: { start: { line: 2 }, end: { line: 2 } } },
        s: { 0: 1 },
      },
    };
    assert.deepEqual(scorePackage("core", coverage, root), [
      {
        file,
        name: "pick",
        complexity: 2,
        start: 1,
        end: 4,
        coverage: 1,
        crap: 2,
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
