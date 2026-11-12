// Engine/trace verification only. Does not follow the reader skill or write a test.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PW_ROOT } from "../lib/pw.mjs";
import { traceActionPointsFrom } from "../lib/package.mjs";

const root = path.resolve(process.argv[2] ?? "prototypes/recorder/reader-kit");
const version = process.argv[3] ?? "1.65";
const text = fs.readFileSync(path.join(root, ".ayme/recordings/latest.yaml"), "utf8");
const id = /^recordingId: (.*)$/m.exec(text)[1];
const side = path.resolve("prototypes/recorder/out/package", id);
const doc = JSON.parse(fs.readFileSync(path.join(side, "document.json")));
const recording = JSON.parse(fs.readFileSync(path.join(side, "recording.json")));
const zip = path.join(root, doc.tracePath);
const hash = () => createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
const original = hash();
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ayme-trace-check-"));
const cli = (...args) => {
  const out = execFileSync("npx", ["--prefix", path.join(PW_ROOT, `pw-${version}`), "--no-install", "playwright", "trace", ...args], { cwd, encoding: "utf8", maxBuffer: 1 << 26 });
  assert(!out.includes("### Error"), out);
  return out;
};
const phaseFlag = version === "1.62" ? "--name" : "--phase";
let count = 0;
try {
  cli("open", zip);
  const actions = cli("actions");
  cli("close");
  cli("open", zip);
  assert.equal(cli("actions"), actions, "positions repeat after close/reopen");
  for (const point of doc.traceActionPoints) {
    const entry = doc.visits.flatMap((v) => v.timelineEntries).find((e) => e.interaction?.id === point.interactionId);
    for (const phase of ["before", "after"]) {
      const position = point[`${phase}SnapshotId`];
      if (!position) continue;
      assert.match(position, /^\d+$/);
      const action = cli("action", position);
      assert(action.includes('expression: "() => 0"'), action);
      const expression = `JSON.stringify({url:location.href, stamped:document.querySelectorAll('[__playwright_aria_ref__]').length, add:!!document.querySelector('[data-test="add-to-cart-sauce-labs-backpack"]'), remove:!!document.querySelector('[data-test="remove-sauce-labs-backpack"]'), item:!!document.querySelector('[data-test="inventory-item"]')})`;
      const out = cli("snapshot", position, phaseFlag, "after", "eval", expression);
      const result = out.split("### Result\n")[1]?.split("\n###")[0].trim();
      assert(result, out);
      const dom = JSON.parse(JSON.parse(result));
      assert.equal(dom.stamped, 0);
      if (entry.interaction.targetSelector?.includes("add-to-cart-sauce-labs-backpack")) {
        assert.equal(dom.add, phase === "before");
        assert.equal(dom.remove, phase === "after");
      }
      if (point.interactionId === "interaction_8") assert.equal(dom.item, phase === "before");
      console.log(`PASS ${version} ${point.interactionId} ${phase}: position ${position}, marker call, URL ${dom.url}, no stamped refs`);
      count++;
    }
  }
} finally {
  try { cli("close"); } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
const repeated = traceActionPointsFrom(zip, recording.tracePoints.map((p) => ({ ...p, ...doc.traceActionPoints.find((d) => d.interactionId === p.interactionId) })), recording.meta.playwright);
assert.deepEqual(repeated.points, doc.traceActionPoints);
assert.equal(hash(), original);
console.log(`PASS ${version}: ${count} snapshot lookups; deterministic positions; before/after cart state; trace SHA256 unchanged ${original}`);
