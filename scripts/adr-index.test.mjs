import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { adrIndexText, checkAdrIndex } from "./adr-index.mjs";

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const adr = (status, title) =>
  `---\nstatus: ${status}\n---\n\n# ${title}\n\nBody.\n`;

/** A repository with ADRs, and the index they generate unless `index` says otherwise. */
function repo(files, index) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr-index-"));
  roots.push(root);
  const all = {
    "docs/adr/0001-first.md": adr("accepted", "First"),
    "docs/adr/0003-third.md": adr("accepted", "Third"),
    "docs/adr/retired/0002-second.md": adr("superseded by ADR-0003", "Second"),
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    if (text === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  fs.writeFileSync(
    path.join(root, "docs/adr/README.md"),
    index ?? adrIndexText(root)
  );
  return root;
}

test("the index lists the ADRs in force by number, linked, and not the retired ones", () => {
  const text = adrIndexText(repo({}));
  const items = text.split("\n").filter((line) => line.startsWith("- "));
  assert.deepEqual(items, [
    "- [ADR-0001: First](0001-first.md)",
    "- [ADR-0003: Third](0003-third.md)",
  ]);
});

test("an index that matches the ADRs passes", () => {
  assert.deepEqual(checkAdrIndex(repo({})), []);
});

test("a missing index fails", () => {
  const root = repo({});
  fs.rmSync(path.join(root, "docs/adr/README.md"));
  assert.match(checkAdrIndex(root).join("\n"), /README\.md: out of date/);
});

test("an ADR added without regenerating the index fails", () => {
  const stale = adrIndexText(repo({}));
  const root = repo(
    { "docs/adr/0004-fourth.md": adr("accepted", "Fourth") },
    stale
  );
  assert.match(checkAdrIndex(root).join("\n"), /README\.md: out of date/);
});

test("an ADR retired without regenerating the index fails", () => {
  const stale = adrIndexText(repo({}));
  const root = repo(
    {
      "docs/adr/0003-third.md": undefined,
      "docs/adr/retired/0003-third.md": adr("superseded by ADR-0004", "Third"),
    },
    stale
  );
  assert.match(checkAdrIndex(root).join("\n"), /README\.md: out of date/);
});

test("an ADR retitled without regenerating the index fails", () => {
  const stale = adrIndexText(repo({}));
  const root = repo(
    { "docs/adr/0001-first.md": adr("accepted", "Renamed") },
    stale
  );
  assert.match(checkAdrIndex(root).join("\n"), /README\.md: out of date/);
});

test("a superseded ADR outside retired/ fails", () => {
  const root = repo({
    "docs/adr/0001-first.md": adr("superseded by ADR-0003", "First"),
  });
  assert.deepEqual(checkAdrIndex(root), [
    "docs/adr/0001-first.md: superseded, so it belongs in docs/adr/retired/",
  ]);
});

test("a deprecated ADR inside retired/ passes and leaves the index", () => {
  const root = repo({
    "docs/adr/0003-third.md": undefined,
    "docs/adr/retired/0003-third.md": adr("deprecated", "Third"),
  });
  assert.deepEqual(checkAdrIndex(root), []);
  const items = adrIndexText(root)
    .split("\n")
    .filter((line) => line.startsWith("- "));
  assert.deepEqual(items, ["- [ADR-0001: First](0001-first.md)"]);
});

test("a deprecated ADR outside retired/ fails", () => {
  const root = repo({
    "docs/adr/0001-first.md": adr("deprecated", "First"),
  });
  assert.deepEqual(checkAdrIndex(root), [
    "docs/adr/0001-first.md: deprecated, so it belongs in docs/adr/retired/",
  ]);
});

test("an ADR in force inside retired/ fails", () => {
  const root = repo({
    "docs/adr/retired/0002-second.md": adr("accepted", "Second"),
  });
  assert.deepEqual(checkAdrIndex(root), [
    "docs/adr/retired/0002-second.md: in force, so it does not belong in docs/adr/retired/",
  ]);
});

test("an ADR with no status fails", () => {
  const root = repo({ "docs/adr/0001-first.md": "# First\n\nBody.\n" });
  assert.match(checkAdrIndex(root).join("\n"), /0001-first\.md: no `status`/);
});
