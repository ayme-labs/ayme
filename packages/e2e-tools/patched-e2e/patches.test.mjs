import assert from "node:assert/strict";
import { test } from "node:test";

import { applyHunks, loadPatches, parsePatch } from "./patches.mjs";

test("the three patches load, each with a hunk for every file it names", () => {
  const patches = loadPatches();
  assert.deepEqual(patches.map(({ name }) => name).sort(), [
    "@e2e-dev/acp",
    "@e2e-dev/core",
    "e2e",
  ]);
  for (const { name, files } of patches) {
    assert.ok(files.size > 0, `${name} changes no file`);
    for (const [file, hunks] of files)
      assert.ok(hunks.length > 0, `${name}'s ${file} has no hunk`);
  }
});

test("a hunk with fewer added lines than its header says fails to load", () => {
  // The header says one old line and two new; the hunk adds none.
  const truncated = "diff --git a/f.js b/f.js\n@@ -2,1 +2,2 @@\n b\n";
  assert.throws(
    () => parsePatch(truncated, "truncated"),
    /truncated is damaged: the hunk of f\.js at line 2 has 1 old and 1 new lines, its header says 1 and 2/
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
