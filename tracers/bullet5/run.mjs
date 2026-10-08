// Tracer bullet 5: natural ref collisions between our Node-injected InjectedScript copy and the page's own Lite.
// Usage: node tracers/bullet5/run.mjs <mode> <variant> <inspector|noinspector> [trials] [adds]
//   mode node-first:  Node runs ListPage.addItem on real Playwright, waits for a Settled Page (250 ms), captures;
//                     then the agent (ayme mcp, page runtime) reads `snapshot`; then both click "Add item" by ref.
//   mode agent-first: the agent calls ListPage.addItem through ayme mcp; Node captures as soon as the call returns.
//   variant plain | shared (counter on window under Symbol.for) | prefix7 (frameSeq 7)
import { writeFileSync } from "node:fs";
import { open, captureFn, waitSettledFn, WT } from "./common.mjs";

const [mode = "node-first", variant = "plain", insp = "inspector", trialsArg = "10", addsArg = "10"] = process.argv.slice(2);
const TRIALS = Number(trialsArg), ADDS = Number(addsArg), inspector = insp === "inspector";
const tag = `${mode}.${variant}.${insp}${process.env.OUT_SUFFIX ?? ""}`;
const result = { mode, variant, inspector, trials: [] };

const refOnLine = (text, needle) => (text.split("\n").find((l) => l.includes(needle)) ?? "").match(/\[ref=([^\]]+)\]/)?.[1];
const agentRefOnLine = (text, needle) => (text.split("\n").find((l) => l.includes(needle)) ?? "").match(/- ((?:f\d+)?e\d+) /)?.[1];
const agentDupes = (text) => { const c = {}; for (const m of text.matchAll(/^\s*- ((?:f\d+)?e\d+)\b(.*)$/gm)) (c[m[1]] ??= []).push(m[2].trim().slice(0, 60)); return Object.entries(c).filter(([, v]) => v.length > 1).map(([ref, lines]) => ({ ref, lines })); };
const items = (page) => page.locator('ul[aria-label="Items"] > li').count();
const mintsSince = (page, i) => page.evaluate((i) => window.__aymeTracer.mints.slice(i).map(({ stack, ...m }) => m), i);
const mintCount = (page) => page.evaluate(() => window.__aymeTracer.mints.length);
const describeRef = (page, ref) => page.locator(`ayme-ref=${ref}`).evaluate((el) => `${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 30)}"`).catch((e) => "ERR " + e.message.split("\n")[0]);

async function agentSnapshot(agent) {
  const r = await agent.call("snapshot", {});
  if (r.isError) return { isError: true, text: r.text };
  let structure;
  try { structure = JSON.parse(r.text).structure; } catch { structure = r.text; }
  return { isError: false, structure, dupes: agentDupes(structure) };
}

for (let trial = 1; trial <= TRIALS; trial++) {
  const s = await open({ variant, inspector });
  const { page, agent } = s;
  const T = { trial, steps: [] };
  try {
    T.pageMintsAtLoad = await mintCount(page);
    T.pageMaxRefAtLoad = await page.evaluate(() => Math.max(0, ...window.__aymeTracer.mints.map((m) => +m.ref.replace(/^f\d+/, "").slice(1))));
    let cap = await page.evaluate(captureFn);
    T.nodeMintsAtFirstCapture = (await mintsSince(page, T.pageMintsAtLoad)).filter((m) => m.by === "node").length;

    for (let k = 1; k <= ADDS; k++) {
      const m0 = await mintCount(page);
      const step = { k };
      if (mode === "node-first") {
        // Node runs ListPage.addItem on real Playwright, as a Node-side Page Object Tool would.
        await page.evaluate((fn) => { window.__clickT = undefined; document.addEventListener("click", () => (window.__clickT = performance.now()), { capture: true, once: true }); window.__settle = (0, eval)(fn)(); }, `(${waitSettledFn})`);
        await page.getByRole("textbox", { name: "New item" }).fill(`item ${k}`);
        await page.getByRole("button", { name: "Add item" }).click();
        const settled = await page.evaluate(() => window.__settle);
        cap = await page.evaluate(captureFn);
        const clickT = await page.evaluate(() => window.__clickT);
        step.settled = settled.stable; step.settleMs = Math.round(settled.ms);
        step.captureAfterClickMs = Math.round(cap.t - clickT);
        const mints = await mintsSince(page, m0);
        const li = mints.find((m) => m.tag === "LI");
        step.liMintedBy = li?.by ?? "none"; step.liRef = li?.ref;
        step.liPageMintAfterClickMs = li?.by === "page" ? Math.round(li.t - clickT) : undefined;
        step.nodeMints = mints.filter((m) => m.by === "node").map((m) => `${m.ref} ${m.tag} ${m.role} "${m.name}"`);
        step.pageMintsCount = mints.filter((m) => m.by === "page").length;
      } else {
        const r = await agent.call("ListPage.addItem", { text: `item ${k}` });
        step.agentAddError = r.isError ? r.text.slice(0, 200) : undefined;
        cap = await page.evaluate(captureFn);
        const mints = await mintsSince(page, m0);
        const li = mints.find((m) => m.tag === "LI");
        step.liMintedBy = li?.by ?? "none"; step.liRef = li?.ref;
        step.nodeMints = mints.filter((m) => m.by === "node").map((m) => `${m.ref} ${m.tag} ${m.role} "${m.name}"`);
        step.pageMintsCount = mints.filter((m) => m.by === "page").length;
      }
      step.items = await items(page);
      step.nodeDupes = cap.dupes;
      T.steps.push(step);
    }
    // Let any Inspector re-capture land, then re-capture in Node, so both texts describe one settled DOM.
    await page.waitForTimeout(1200);
    const m1 = await mintCount(page);
    cap = await page.evaluate(captureFn);
    T.nodeMintsInFinalCapture = (await mintsSince(page, m1)).filter((m) => m.by === "node").map((m) => `${m.ref} ${m.tag} ${m.role} "${m.name}"`);
    if (process.env.SAVE_TEXT) T.nodeFinalDupLines = cap.full.split("\n").filter((l) => cap.dupes.some((d) => l.includes(`[ref=${d.ref}]`))).map((l) => l.trim());
    T.nodeFinal = { dupes: cap.dupes, distilledMain: cap.distilled.split("\n").filter((l) => /main|heading "Groceries"|textbox|checkbox|button "(Add item|Clear)"|list "Items"|listitem/.test(l)).join("\n") };
    T.allNodeMints = (await page.evaluate(() => window.__aymeTracer.mints.filter((m) => m.by === "node").map((m) => `${m.ref} ${m.tag} ${m.role} "${m.name}"`)));

    // Interleaving 2: the agent reads the page through the page's own runtime, after Node has (or has not) minted.
    const snap = await agentSnapshot(agent);
    T.agentSnapshot = snap.isError ? { isError: true, text: snap.text.slice(0, 400) } : { isError: false, dupes: snap.dupes, mainLines: snap.structure.split("\n").filter((l) => /main|heading "Groceries"|textbox|checkbox|button "(Add item|Clear)"|list "Items"|listitem/.test(l)).join("\n") };

    // The Inspector's path (look(), no duplicate check) versus the agent's (captureTree() with findDuplicateRef).
    T.inspectorLook = await page.evaluate(async (u) => {
      const m = await import(u);
      const out = {};
      try { const l = await m.lookAtPageStateForDocument(document); out.look = "ok, " + l.elementsByRef.size + " refs"; } catch (e) { out.look = "ERR " + String(e).slice(0, 200); }
      try { const t = await m.capturePageState(document.body); out.capturePageState = "ok, " + t.length + " chars"; } catch (e) { out.capturePageState = "ERR " + String(e).slice(0, 200); }
      return out;
    }, `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 4791}/@fs${WT}/packages/ayme/dist/internal.mjs`);
    // A further agent action on the same document after the read.
    const more = await agent.call("ListPage.countItems", {});
    T.agentCountItems = { isError: more.isError, text: more.text.slice(0, 200) };

    // Wrong-click evidence: click "Add item" by the ref each text gives it, and count items.
    await page.evaluate(() => document.addEventListener("click", (e) => { const t = e.composedPath()[0]; const host = t.closest?.("[role=treeitem],button,[role=button]"); window.__clickLog = { target: `${t.tagName?.toLowerCase()} "${(t.textContent || "").trim().slice(0, 30)}"`, control: host ? `${host.tagName.toLowerCase()} role=${host.getAttribute("role")} "${(host.getAttribute("aria-label") || host.textContent || "").trim().slice(0, 40)}" aria-selected=${host.getAttribute("aria-selected")} aria-pressed=${host.getAttribute("aria-pressed")} aria-expanded=${host.getAttribute("aria-expanded")}` : null }; }, true));
    const controlState = (ref) => page.locator(`ayme-ref=${ref}`).evaluate((el) => { const host = el.closest("[role=treeitem],button,[role=button]"); return host ? `${host.tagName.toLowerCase()} "${(host.getAttribute("aria-label") || host.textContent || "").trim().slice(0, 40)}" aria-selected=${host.getAttribute("aria-selected")} aria-pressed=${host.getAttribute("aria-pressed")} aria-expanded=${host.getAttribute("aria-expanded")} aria-current=${host.getAttribute("aria-current")}` : null; }).catch((e) => "ERR " + e.message.split("\n")[0]);
    const nodeAddRef = refOnLine(cap.distilled, 'button "Add item"');
    const before = await items(page);
    T.nodeClick = { ref: nodeAddRef, resolvesTo: await describeRef(page, nodeAddRef), dup: cap.dupes.some((d) => d.ref === nodeAddRef) };
    T.nodeClick.controlBefore = await controlState(nodeAddRef);
    await page.getByRole("textbox", { name: "New item" }).fill("by node ref");
    T.nodeClick.error = await page.locator(`ayme-ref=${nodeAddRef}`).click({ timeout: 3000 }).then(() => undefined, (e) => e.message.split("\n")[0]);
    await page.waitForTimeout(300);
    T.nodeClick.itemsBefore = before; T.nodeClick.itemsAfter = await items(page);
    T.nodeClick.clickLanded = await page.evaluate(() => window.__clickLog);
    T.nodeClick.controlAfter = await page.evaluate(() => window.__clickLog?.control);
    if (!snap.isError) {
      const agentAddRef = agentRefOnLine(snap.structure, 'button "Add item"');
      await page.getByRole("textbox", { name: "New item" }).fill("by agent ref");
      const b2 = await items(page);
      await page.evaluate(() => (window.__clickLog = null)); const r = await agent.call("click", { target: agentAddRef });
      await page.waitForTimeout(300);
      T.agentClick = { ref: agentAddRef, isError: r.isError, text: r.text.slice(0, 300), itemsBefore: b2, itemsAfter: await items(page), landed: await page.evaluate(() => window.__clickLog) };
      // Prefix probe: does the page runtime accept a Node-minted f7eN ref end to end?
      const f7 = snap.structure.match(/^\s*- (f\d+e\d+)\b(.*)$/m);
      if (f7) { await page.evaluate(() => (window.__clickLog = null)); const r2 = await agent.call("click", { target: f7[1] }); T.agentClickPrefixed = { ref: f7[1], line: f7[2].trim().slice(0, 60), isError: r2.isError, text: r2.text.slice(0, 200), landed: await page.evaluate(() => window.__clickLog) }; }
    } else {
      // The snapshot failed; try the click on the ref the page had for "Add item" at load anyway.
      const r = await agent.call("click", { target: "e8" });
      T.agentClick = { ref: "e8 (from load)", isError: r.isError, text: r.text.slice(0, 300) };
    }
    T.mintsTail = await page.evaluate(() => window.__aymeTracer.mints.slice(-40).map((m) => `${Math.round(m.t)} ${m.by} ${m.ref} ${m.tag} ${m.role} "${m.name}"`));
    T.agentSnapshotFull = snap.isError ? undefined : snap.structure.length < 6000 ? snap.structure : snap.structure.slice(0, 6000);
    T.errors = s.errors;
  } catch (e) {
    T.fatal = String(e.stack ?? e).slice(0, 800);
  } finally {
    await s.close();
  }
  result.trials.push(T);
  const st = T.steps ?? [];
  console.log(`[${tag}] trial ${trial}: li by node ${st.filter((x) => x.liMintedBy === "node").length}/${st.length}, node mints ${T.allNodeMints?.length}, node dupes ${T.nodeFinal?.dupes.length}, agent ${T.agentSnapshot?.isError ? "ERROR" : "dupes " + T.agentSnapshot?.dupes?.length}, nodeClick ${T.nodeClick?.itemsBefore}->${T.nodeClick?.itemsAfter}, agentClick ${T.agentClick?.itemsBefore}->${T.agentClick?.itemsAfter}${T.fatal ? " FATAL " + T.fatal.slice(0, 200) : ""}`);
  writeFileSync(`${WT}/tracers/bullet5/out/${tag}.json`, JSON.stringify(result, null, 2));
}
