import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import base from "./base.js";
import { message as adrMessage, plugin } from "./testing-entries.js";

const linter = new Linter();

/** What `base` reports under the testing-entries policy for `code` in
 *  `filename`: "refused" for each refusal that cites ADR-0057. */
function lint(code, filename) {
  return linter
    .verify(code, base, { filename })
    .filter((message) => message.ruleId?.startsWith(`${plugin}/`))
    .map((message) =>
      message.message.endsWith(adrMessage) ? "refused" : message.message
    );
}

const staticImport =
  'import { recordPublishedTools } from "@ayme-dev/webmcp/testing";\nexport { recordPublishedTools };\n';

test("the refusal cites ADR-0057", () => {
  assert.match(
    adrMessage,
    /docs\/adr\/0057-test-support-lives-beside-src-and-is-never-published\.md/
  );
});

test("a test file may import test support", () => {
  const deepImport =
    'import { renderPart } from "../../testing/renderPart";\nexport { renderPart };\n';
  assert.deepEqual(lint(deepImport, "src/runs/Runs.browser.test.tsx"), []);
  for (const filename of [
    "src/runtime.test.ts",
    "src/view.test.tsx",
    "src/page.browser.test.ts",
    "tests/integration.spec.ts",
  ])
    assert.deepEqual(lint(staticImport, filename), [], filename);
});

test("test support may import its own parts and another package's", () => {
  const part =
    'import { Inspector } from "../testing/pom/Inspector";\nexport { Inspector };\n';
  assert.deepEqual(lint(part, "testing/tools/startedSession.ts"), []);
  assert.deepEqual(lint(staticImport, "testing/index.ts"), []);
});

test("source may not import test support", () => {
  for (const code of [
    staticImport,
    'import type { RecordingDriver } from "@ayme-dev/webmcp/testing";\nexport type { RecordingDriver };\n',
    'export * from "@ayme-dev/webmcp/testing";\n',
    'export { startAgent } from "../testing";\n',
    'import "../testing/index.js";\n',
    'import { Inspector } from "../testing/pom/Inspector";\nexport { Inspector };\n',
    'import "../../testing/renderPart";\n',
  ])
    assert.deepEqual(lint(code, "src/index.ts"), ["refused"], code);
});

test("source may not load test support dynamically", () => {
  for (const code of [
    'export const testing = import("@ayme-dev/webmcp/testing");\n',
    'export const testing = import("../testing");\n',
    'export type Agent = import("../testing").Agent;\n',
    'export const testing = import("../testing/pom/Inspector");\n',
    'export const testing = require("@ayme-dev/webmcp/testing");\n',
  ])
    assert.deepEqual(lint(code, "src/index.ts"), ["refused"], code);
});

test("other entries stay importable", () => {
  for (const code of [
    'import "@ayme-dev/ayme";\n',
    'import "@ayme-dev/ayme/internal";\n',
    'import "./testingHelpers";\n',
    'import "./testing-library/render";\n',
    'import "some-package/testing";\n',
  ])
    assert.deepEqual(lint(code, "src/index.ts"), [], code);
});
