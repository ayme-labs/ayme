// Two cases the shipped skill's ref rules rest on, on stock Playwright:
// 1. A button the app re-creates with the same role and name, then clicked:
//    is its targetRef a node the package has shown (baseline or <added>)?
// 2. A full page load: how does the public snapshot number the new document?
// usage: node probes/package-edges.mjs [1.65]
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHuman } from "../lib/human.mjs";
import { renderPackageText, packageDocument } from "../lib/package.mjs";
import { createParser, Observations } from "../lib/core.mjs";
import { sleep } from "../lib/pw.mjs";
import { openRecording } from "../run.mjs";
import { checkRefRules, loadReleased } from "../check-package.mjs";

const pages = {
  "/": `<!doctype html><title>one</title><main>
    <button id="swap">Swap</button>
    <div id="slot"><button id="save">Save</button></div>
    <a id="next" href="/two">Next page</a>
    <section aria-label="Stable"><p></p></section><p id="log"></p></main>
    <script>
      document.getElementById('swap').onclick = () => {
        // same role, same name, a new element
        document.getElementById('slot').innerHTML = '<button id="save">Save</button>';
        document.getElementById('save').onclick = () => (document.getElementById('log').textContent = 'saved');
      };
    </script>`,
  "/two": `<!doctype html><title>two</title><main><h1>Second page</h1><button id="b">Only button</button></main>`,
};
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(pages[req.url] ?? "not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { browser, context, page, recording } = await openRecording({
  mode: "gate-b",
  version: process.argv[2] ?? "1.65",
  url: origin + "/",
});
const human = await createHuman(context, page);
await human.key("F8");
await sleep(1500);
for (const selector of ["#swap", "#save", "#next"]) {
  await human.clickOn(page.locator(selector));
  await sleep(1500);
}
await human.clickOn(page.locator("#b"));
await sleep(1500);
await page.evaluate(() => document.querySelector("h1").textContent = "Late at finish");
assert(!recording.visits.at(-1).trailing);
const result = await recording.stop();
await browser.close();
server.close();
const text = renderPackageText(
  result.model,
  { recordingId: "rec_probe", createdAt: "-", url: origin, tracePath: null },
  []
);
console.log(text.replaceAll(origin, "http://probe"));
console.log(JSON.stringify(checkRefRules(text), null, 1));

const first = result.model.visits[0];
const save = first.baselineTree.getAllNodes().find((n) => n.name === "Save");
const saveClick = first.timelineEntries.find((e) => e.interaction?.targetSelector?.includes("Save"));
assert.equal(saveClick.interaction.targetRef, save.ref);
const stable = first.baselineTree.getAllNodes().find((n) => n.role === "paragraph");
assert.match(stable.ref, /^s_/);
for (const e of first.timelineEntries) {
  assert(e.beforeTree.hasNode(stable.ref));
  assert(e.afterTree.hasNode(stable.ref));
}
const key = first.timelineEntries.find((e) => e.interaction?.type === "press");
assert(!("targetRef" in key.interaction));
assert.equal(key.interaction.targetSelector, "body");
assert.equal(first.cause, "initial");
const leaving = first.timelineEntries.find((e) => e.leftVisit);
assert(leaving);
assert(!leaving.changeTree.getAllNodes().some((n) => ["added", "removed"].includes(n.status?.kind) || n.status?.selfChanged));
const rawSave = result.entries.find((e) => e.action.selector?.includes("Save"));
assert.notEqual(rawSave.action.ref, save.ref, "Playwright really gave the re-created button a new ref");
assert.equal(checkRefRules(text).unresolved.length, 0);
console.log(`PASS recreated Save keeps ${save.ref}; stable paragraph keeps ${stable.ref}; unfocused F8 omits targetRef and keeps body; initial cause; navigation has no Change Tree`);

// Required JSON targetRef vs omitted text is a real released-schema mismatch.
const { released } = await loadReleased();
const header = { recordingId: "rec_probe", createdAt: new Date().toISOString(), url: origin, tracePath: null };
const doc = packageDocument(result.model, header, []);
assert.equal(released.renderStructuralRecordingPackage({ ...result.model, traceActionPoints: [] }, header), renderPackageText(result.model, header, []));
const finalChange = result.model.visits.at(-1).timelineEntries.at(-1);
assert.equal(finalChange.kind, "change");
assert(finalChange.afterTree.getAllNodes().some((n) => n.name === "Late at finish"));
const parsed = released.RecordingPackageSchema.safeParse(doc);
assert(!parsed.success);
assert(parsed.error.issues.some((i) => JSON.stringify(i).includes("targetRef")));
const withNull = structuredClone(doc);
for (const visit of withNull.visits) for (const e of visit.timelineEntries)
  if (e.kind === "interaction" && !("targetRef" in e.interaction)) e.interaction.targetRef = null;
assert(released.RecordingPackageSchema.safeParse(withNull).success);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayme-missing-target-"));
try {
  const dir = path.join(root, ".ayme/recordings/rec_probe");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.yaml"), text);
  const stored = await new released.RecordingStore(root).readPackageById("rec_probe");
  assert.equal(stored.text, text);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("PASS finish samples the trailing change once; released text renderer matches missing-target text byte for byte");
console.log("PASS released store reads omitted targetRef; released JSON schema REJECTS omission and accepts null (format finding)");

// Ambiguous one-to-many lineage is deliberately left unresolved by core.
const parser = createParser();
const observations = new Observations(parser, { now: () => 0 });
const v = { pageId: "probe", visitId: "visit_1" };
const a = { tree: parser.parse('- main [ref=e1]:\n  - paragraph') };
const b = { tree: parser.parse('- main [ref=e1]:\n  - paragraph\n  - paragraph') };
await observations.observe(v, a);
await observations.observe(v, b);
const old = a.tree.getAllNodes().find((n) => n.role === "paragraph").ref;
const resolution = await observations.session.readIdentityLedger(v.pageId, (ledger) => ledger.resolve(old));
assert.equal(resolution.reason, "ambiguous");
console.log("LIMIT core ledger: one ref-less paragraph becoming two identical siblings has ambiguous lineage; reported, not patched in core");
