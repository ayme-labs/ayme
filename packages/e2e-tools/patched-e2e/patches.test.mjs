import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { applyHunks, loadPatches, parsePatch } from "./patches.mjs";

const core = readFileSync(
  new URL("../patches/@e2e-dev__core@0.25.0.patch", import.meta.url),
  "utf8"
);

test("every patch loads whole", () => {
  for (const { name, files } of loadPatches())
    assert.ok(files.size > 0, `${name} changes no file`);
});

test("a hunk with its last added line deleted fails to load", () => {
  const lines = core.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  const nextHunk = lines.findIndex(
    (line, at) =>
      at > firstHunk && (line.startsWith("@@") || line.startsWith("diff --git"))
  );
  const lastAdded = lines.findLastIndex(
    (line, at) => at > firstHunk && at < nextHunk && line.startsWith("+")
  );
  lines.splice(lastAdded, 1);
  assert.throws(
    () => parsePatch(lines.join("\n"), "truncated"),
    /truncated is damaged: the hunk of \S+ at line \d+ has \d+ old and \d+ new lines/
  );
});

test("a hunk applies only where its old lines are", () => {
  const [hunk] = parsePatch(
    "diff --git a/f.js b/f.js\n@@ -2,1 +2,2 @@\n b\n+c\n",
    "inline"
  ).get("f.js");
  assert.equal(applyHunks("a\nb\nd", [hunk], "f.js"), "a\nb\nc\nd");
  assert.throws(() => applyHunks("a\nx\nd", [hunk], "f.js"), /does not match/);
});
