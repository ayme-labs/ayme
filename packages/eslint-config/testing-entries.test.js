import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import base from "./base.js";

const linter = new Linter({ configType: "flat" });
const adrMessage =
  "Only test files may import a testing entry (docs/adr/0026-test-seams-behind-a-testing-entry.md).";

/** What `base` reports under the testing-entries policy for `code` in
 *  `filename`: "refused" for each refusal that cites ADR-0026. */
function lint(code, filename) {
  return linter
    .verify(code, base, { filename })
    .filter((message) => message.ruleId?.startsWith("testing-entries/"))
    .map((message) =>
      message.message.endsWith(adrMessage) ? "refused" : message.message
    );
}

const staticImport =
  'import { recordPublishedTools } from "@ayme-dev/webmcp/testing";\nexport { recordPublishedTools };\n';

test("a test file or verification script may import a testing entry", () => {
  for (const filename of [
    "src/runtime.test.ts",
    "src/view.test.tsx",
    "src/page.browser.test.ts",
    "tests/integration.spec.ts",
    "scripts/installed-types.ts",
  ])
    assert.deepEqual(lint(staticImport, filename), [], filename);
});

test("source may not import a testing entry", () => {
  for (const code of [
    staticImport,
    'import type { RecordingDriver } from "@ayme-dev/webmcp/testing";\nexport type { RecordingDriver };\n',
    'import "@ayme-dev/core/structural-observation/testing";\n',
    'export * from "@ayme-dev/webmcp/testing";\n',
    'export { StructuralTreeMockFactory } from "./testing";\n',
    'import "../src/testing.js";\n',
  ])
    assert.deepEqual(lint(code, "src/index.ts"), ["refused"], code);
});

test("source may not load a testing entry dynamically", () => {
  for (const code of [
    'export const testing = import("@ayme-dev/webmcp/testing");\n',
    'export const testing = import("./testing");\n',
    'export const testing = require("@ayme-dev/webmcp/testing");\n',
  ])
    assert.deepEqual(lint(code, "src/index.ts"), ["refused"], code);
});

test("other entries stay importable", () => {
  for (const code of [
    'import "@ayme-dev/webmcp";\n',
    'import "@ayme-dev/webmcp/internal";\n',
    'import "./testingHelpers";\n',
    'import "some-package/testing";\n',
  ])
    assert.deepEqual(lint(code, "src/index.ts"), [], code);
});
