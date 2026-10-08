import assert from "node:assert/strict";
import { test } from "node:test";

import { survivorLines } from "./mutation-survivors.mjs";

test("survivorLines lists survivors with a short replacement and the static flag", () => {
  const at = (line) => ({ start: { line, column: 1 } });
  const report = {
    files: {
      "src/a.ts": {
        mutants: [
          {
            status: "Killed",
            mutatorName: "BooleanLiteral",
            replacement: "false",
            location: at(1),
          },
          {
            status: "Survived",
            mutatorName: "BooleanLiteral",
            replacement: "false",
            location: at(2),
          },
          {
            status: "NoCoverage",
            static: true,
            mutatorName: "StringLiteral",
            replacement: `"${"x".repeat(80)}"`,
            location: at(3),
          },
        ],
      },
    },
  };
  assert.deepEqual(survivorLines("packages/core", report), [
    "- packages/core/src/a.ts:2 Survived BooleanLiteral: `false`",
    "- packages/core/src/a.ts:3 NoCoverage static StringLiteral",
  ]);
});
