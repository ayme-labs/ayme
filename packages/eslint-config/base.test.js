import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import base from "./base.js";

const linter = new Linter();

/** The `no-warning-comments` reports for `code`. */
const lint = (code) =>
  linter
    .verify(code, base, { filename: "file.ts" })
    .filter((message) => message.ruleId === "no-warning-comments");

test("a TODO-style comment is an error, however it is cased", () => {
  for (const term of ["TODO", "fixme", "Hack", "XXX"]) {
    const reports = lint(`// ${term}: later\nexport const a = 1;\n`);
    assert.equal(reports.length, 1, term);
    assert.equal(reports[0].severity, 2, term);
  }
});

test("a comment that names no such term passes", () => {
  assert.deepEqual(lint("// Explains why.\nexport const a = 1;\n"), []);
});
