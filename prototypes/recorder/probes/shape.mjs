// Question 1 and the first half of question 2:
// - do core's tree, reconcile and renderers take Playwright's public snapshot
//   (iframes, open shadow DOM) as it is?
// - is the recorder's event snapshot the same shape as the public snapshot for
//   the same frame?
// usage: node probes/shape.mjs [version]
import assert from "node:assert/strict";
import { loadPlaywright, startRecorder, sleep } from "../lib/pw.mjs";
import { createParser, reconcile, renderChangeTree } from "../lib/core.mjs";
import { parseStructuralRef } from "../../../packages/core/dist/index.mjs";
import { serveFixture } from "../lib/fixture.mjs";
import { createHuman } from "../lib/human.mjs";

const { pw, version } = loadPlaywright(process.argv[2]);
const fixture = await serveFixture();
const browser = await pw.chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(fixture.origin + "/");
const events = [];
const recorder = await startRecorder(context, (e) => events.push(e));
await sleep(500);
const human = await createHuman(context, page);
const { parse } = createParser();
const out = { version, api: recorder.api };

// --- Q1: core on the public snapshot -------------------------------------
const yaml1 = await page.ariaSnapshot({ mode: "ai" });
console.log("== public snapshot ==\n" + yaml1);
const frameRefs = [...yaml1.matchAll(/\[ref=(f\d+e\d+)\]/g)].map((m) => m[1]);
out["frame-prefixed refs in the public snapshot"] = frameRefs;
out["core parseStructuralRef on a frame ref (the grammar issue #1208)"] =
  parseStructuralRef(frameRefs[0]) ?? "rejected (undefined)";
let tree1;
try {
  tree1 = parse(yaml1);
  out["core parses the public snapshot unpatched"] = true;
  out["nodes carrying frame refs in the parsed tree"] = tree1
    .getAllRefs()
    .filter((r) => /^f\d+e\d+$/.test(r)).length;
  out["shadow button in parsed tree"] = tree1
    .getAllNodes()
    .some((n) => n.name === "Shadow button");
} catch (error) {
  out["core parses the public snapshot unpatched"] = String(error);
}
// click the iframe button and the shadow button, reconcile public before/after
await human.clickOn(page.frameLocator("#frame").locator("#inner"));
await sleep(900);
await human.clickOn(page.locator("#shadowBtn"));
await sleep(900);
const yaml2 = await page.ariaSnapshot({ mode: "ai" });
const change = reconcile(tree1, parse(yaml2));
console.log(
  "== change tree: iframe click + shadow click, public before vs after =="
);
console.log(renderChangeTree(change));
out["frame refs resolve"] = await page
  .locator("aria-ref=" + frameRefs[0])
  .evaluate((el) => el.outerHTML.slice(0, 60));

// --- Q2a: same shape? -----------------------------------------------------
// A key press that changes nothing: the recorder snapshots at keydown, and the
// public snapshot right after shows the same moment.
const normalise = (text) =>
  text
    .replace(/ \[ref=[^\]]+\]/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
const dropFrameContent = (lines) => {
  // remove the lines nested under an iframe line, and the iframe's trailing ':'
  const kept = [];
  let skipDeeperThan = null;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    if (skipDeeperThan !== null && indent > skipDeeperThan) continue;
    skipDeeperThan = null;
    if (/^\s*- iframe/.test(line)) {
      skipDeeperThan = indent;
      kept.push(line.replace(/:$/, ""));
    } else kept.push(line);
  }
  return kept;
};
const frameContent = (lines) => {
  const start = lines.findIndex((line) => /^\s*- iframe/.test(line));
  const indent = lines[start].length - lines[start].trimStart().length;
  const inner = [];
  for (const line of lines.slice(start + 1)) {
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= indent) break;
    inner.push(line.slice(indent + 2));
  }
  return inner;
};
const diff = (a, b) => {
  const onlyA = a.filter((line) => !b.includes(line));
  const onlyB = b.filter((line) => !a.includes(line));
  return {
    identical: a.join("\n") === b.join("\n"),
    onlyInEvent: onlyA,
    onlyInPublic: onlyB,
  };
};

// main frame: focus the Other button (a click), then press F8
await human.clickOn(page.locator("#other"));
await sleep(900);
let from = events.length;
await human.key("F8");
await sleep(300);
const publicMain = normalise(await page.ariaSnapshot({ mode: "ai" }));
const pressMain = events.slice(from).find((e) => e.action.name === "press");
out["main frame: event snapshot vs public snapshot (iframe content dropped)"] =
  diff(normalise(pressMain.action.ariaSnapshot), dropFrameContent(publicMain));

// iframe: focus the inner button, press F8
await human.clickOn(page.frameLocator("#frame").locator("#inner"));
await sleep(900);
from = events.length;
await human.key("F8");
await sleep(300);
const publicAll = normalise(await page.ariaSnapshot({ mode: "ai" }));
const pressFrame = events.slice(from).find((e) => e.action.name === "press");
out["iframe: action selector"] = pressFrame.action.selector;
out["iframe: event snapshot vs the iframe's subtree in the public snapshot"] =
  diff(normalise(pressFrame.action.ariaSnapshot), frameContent(publicAll));
out["iframe: event snapshot"] = pressFrame.action.ariaSnapshot;

console.log(JSON.stringify(out, null, 1));
await recorder.stop();
await browser.close();
fixture.close();

assert.equal(out["main frame: event snapshot vs public snapshot (iframe content dropped)"].identical, true);
assert.equal(out["iframe: event snapshot vs the iframe's subtree in the public snapshot"].identical, true);
console.log(`PASS ${version}: event/public shape matches in main frame and iframe`);
