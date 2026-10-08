// Tracer bullet 1: Ayme's own dual capture and an "ayme-ref" selector engine on real Playwright.
// Usage: node tracers/bullet1/run.mjs <variant>
//   main        checks a, b, c, e, f, g
//   d-before    no-op engine registered before ayme-ref
//   d-after     no-op engine registered after ayme-ref
//   d-isolated  contentScript engine reading window.__aymeTracer
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, selectors } from "../../packages/ayme/node_modules/playwright/index.mjs";

const WT = decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(/\/$/, "");
const URL = "http://127.0.0.1:4191/";
const LITE_DIST = `${WT}/node_modules/.pnpm/@ayme-dev+playwright-lite@https+++codeload.github.com+ayme-labs+playwright-lite+tar.gz+_87d6e34d9d9e66fdb0dcc1f715fd5218/node_modules/@ayme-dev/playwright-lite/dist/internal.mjs`;
const variant = process.argv[2] ?? "main";
const out = {};
const save = () => writeFileSync(`${WT}/tracers/bullet1/out/${variant}.json`, JSON.stringify(out, null, 2));

// 1. The injected source from Playwright Lite at cd81df2e.
const tsFile = readFileSync(`${process.env.PLAYWRIGHT_LITE_DIR}/build/generated/injectedScriptSource.ts`, "utf8");
const source = JSON.parse(tsFile.slice(tsFile.indexOf('"'), tsFile.lastIndexOf('"') + 1));
out.sourceChars = source.length;

const OPTIONS = { browserName: "chromium", customEngines: [], frameSeq: 0, isUnderTest: false, isUtilityWorld: false, sdkLanguage: "javascript", shouldPrependErrorPrefix: false, stableRafCount: 0, testIdAttributeName: "data-testid" };
// __export stores getters-as-thunks: module.exports.InjectedScript is () => InjectedScript.
const bootstrap = `(() => {
  const module = { exports: {} };
  ${source}
  const IS = module.exports.InjectedScript();
  window.__aymeTracer = { injected: new IS(window, ${JSON.stringify(OPTIONS)}), refs: new Map() };
})();`;

const AYME_REF = "({ query(root, sel) { return window.__aymeTracer?.refs.get(sel) ?? null; }, queryAll(root, sel) { const e = window.__aymeTracer?.refs.get(sel); return e ? [e] : []; } })";
const NOOP = "({ query(root, sel) { return null; }, queryAll(root, sel) { return []; } })";
// Isolated-world probe: matches root's document.body and reports what it sees in its name attribute? No: it
// returns body when __aymeTracer is visible, otherwise nothing, so count() tells the world.
const SEES_TRACER = "({ query(root, sel) { return window.__aymeTracer ? document.body : null; }, queryAll(root, sel) { return window.__aymeTracer ? [document.body] : []; } })";

if (variant === "d-before") await selectors.register("noop-before", { content: NOOP });
await selectors.register("ayme-ref", { content: AYME_REF });
if (variant === "d-after") await selectors.register("noop-after", { content: NOOP });
if (variant === "d-isolated") {
  await selectors.register("sees-tracer-iso", { content: SEES_TRACER }, { contentScript: true });
  await selectors.register("sees-tracer-main", { content: SEES_TRACER });
}

// In-page capture: fills refs (ref -> element) in the page, returns text only.
const captureFn = () => {
  const t = window.__aymeTracer;
  const t0 = performance.now();
  const r = t.injected.captureAriaSnapshot(document.body);
  const ms = performance.now() - t0;
  const refs = new Map();
  const dupes = [];
  for (const [el, ref] of r.refsByElement) {
    if (refs.has(ref)) dupes.push({ ref, a: refs.get(ref).tagName, b: el.tagName });
    refs.set(ref, el);
  }
  t.refs = refs;
  return { distilled: r.distilledText, full: r.fullText, count: refs.size, refsByElementSize: r.refsByElement.size, uniqueRefs: new Set(r.refsByElement.values()).size, dupes, inPageMs: ms };
};

const marks = () => [...document.querySelectorAll("*")].filter((e) => e._ariaRef).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}=${e._ariaRef.ref}(${e._ariaRef.role}:${JSON.stringify(e._ariaRef.name).slice(0, 30)})`);
const refOf = (text, line) => (text.split("\n").find((l) => l.includes(line)) ?? "").match(/\[ref=([^\]]+)\]/)?.[1];
const refTokens = (text) => [...text.matchAll(/\[ref=([^\]]+)\]/g)].map((m) => m[1]);
const dupTokens = (text) => { const c = {}; for (const r of refTokens(text)) c[r] = (c[r] ?? 0) + 1; return Object.entries(c).filter(([, n]) => n > 1); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return (s[4] + s[5]) / 2; };
const stripRefs = (t) => t.replace(/ \[ref=[^\]]+\]/g, "");

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.addInitScript(bootstrap);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.getByRole("button", { name: "Increment" }).waitFor();
  await page.waitForTimeout(1000);
  out.tracerInstalled = await page.evaluate(() => !!window.__aymeTracer?.injected);

  if (variant.startsWith("d-")) {
    await page.evaluate(captureFn);
    const snap = await page.evaluate(captureFn);
    const ref = refOf(snap.distilled, 'button "Increment"');
    out.incrementRef = ref;
    out.aymeRefCount = await page.locator(`ayme-ref=${ref}`).count();
    out.aymeRefText = await page.locator(`ayme-ref=${ref}`).textContent();
    const before = await page.locator("output").textContent();
    await page.locator(`ayme-ref=${ref}`).click({ timeout: 5000 });
    out.clickOutput = { before, after: await page.locator("output").textContent() };
    if (variant === "d-before") out.chainedWithNoop = await page.locator(`noop-before=x >> ayme-ref=${ref}`).count().catch((e) => "ERR " + e.message.split("\n")[0]);
    if (variant === "d-after") out.chainedWithNoop = await page.locator(`ayme-ref=${ref} >> noop-after=x`).count().catch((e) => "ERR " + e.message.split("\n")[0]);
    if (variant === "d-isolated") {
      out.isoAlone = await page.locator("sees-tracer-iso=x").count().catch((e) => "ERR " + e.message.split("\n")[0]);
      out.mainAlone = await page.locator("sees-tracer-main=x").count().catch((e) => "ERR " + e.message.split("\n")[0]);
      // Chained: when one engine of the selector needs the main world, where does the other one run?
      out.isoChainedAfterAymeRef = await page.locator(`ayme-ref=${ref} >> xpath=/ancestor::body >> sees-tracer-iso=x`).count().catch((e) => "ERR " + e.message.split("\n")[0]);
      out.isoThenAymeRef = await page.locator(`sees-tracer-iso=x >> ayme-ref=${ref}`).count().catch((e) => "ERR " + e.message.split("\n")[0]);
      out.aymeRefChainedAfterCss = await page.locator(`css=body >> ayme-ref=${ref}`).count().catch((e) => "ERR " + e.message.split("\n")[0]);
    }
    out.errors = errors;
    save();
  } else {
    // (e) part 1: marks the page's own Lite instance left before our first capture.
    out.e_marksBefore = await page.evaluate(marks);

    // (a) first Node capture.
    let t0 = performance.now();
    const s1 = await page.evaluate(captureFn);
    out.a = { nodeRoundTripMs: performance.now() - t0, inPageMs: s1.inPageMs, distilledChars: s1.distilled.length, fullChars: s1.full.length, distilledLines: s1.distilled.split("\n").length, fullLines: s1.full.split("\n").length, count: s1.count, refsByElementSize: s1.refsByElementSize, uniqueRefs: s1.uniqueRefs, dupes: s1.dupes, distilled: s1.distilled, full: s1.full };
    out.e_marksAfterNodeCapture = await page.evaluate(marks);
    out.e_dupTokensDistilled = dupTokens(s1.distilled);
    out.e_dupTokensFull = dupTokens(s1.full);

    // (b) click through ayme-ref.
    const incRef = refOf(s1.distilled, 'button "Increment"');
    const before = await page.locator("output").textContent();
    await page.locator(`ayme-ref=${incRef}`).click();
    const after = await page.locator("output").textContent();
    out.b = { incRef, before, after };

    // (c) re-capture.
    const s2 = await page.evaluate(captureFn);
    const t1 = refTokens(s1.full), t2 = refTokens(s2.full);
    out.c = { incRefAfter: refOf(s2.distilled, 'button "Increment"'), refsOnlyBefore: t1.filter((r) => !t2.includes(r)), refsOnlyAfter: t2.filter((r) => !t1.includes(r)), linesChanged: [], distilledAfter: s2.distilled };
    const l1 = s1.full.split("\n"), l2 = s2.full.split("\n");
    for (let i = 0; i < Math.max(l1.length, l2.length); i++) if (l1[i] !== l2[i]) out.c.linesChanged.push({ before: l1[i], after: l2[i] });

    // (e) part 2: make new elements, so the Node instance has to mint refs from its own counter.
    await page.getByRole("button", { name: "Unmount counter" }).click();
    await page.getByRole("button", { name: "Mount counter" }).click();
    await page.getByRole("button", { name: "Increment" }).waitFor();
    await page.waitForTimeout(500);
    out.e_marksAfterRemount_beforeNodeCapture = await page.evaluate(marks);
    const s3 = await page.evaluate(captureFn);
    out.e_afterRemountNode = { distilled: s3.distilled, dupes: s3.dupes, dupTokensFull: dupTokens(s3.full), dupTokensDistilled: dupTokens(s3.distilled) };
    out.e_marksAfterRemountNodeCapture = await page.evaluate(marks);

    // (e) part 3 + (g): a second Lite instance in-page through /@fs.
    const liteUrl = "/@fs" + LITE_DIST;
    out.e_liteImport = await page.evaluate(async (u) => {
      try { const m = await import(u); window.__liteB = m; return { ok: true, exports: Object.keys(m) }; }
      catch (e) { return { ok: false, error: String(e) }; }
    }, liteUrl);
    if (out.e_liteImport.ok) {
      // (g) same DOM state, Node capture then Lite capture, no DOM change between.
      const sNode = await page.evaluate(captureFn);
      const sLite = await page.evaluate(() => { const r = window.__liteB.captureAriaSnapshot(document.body); return { distilled: r.distilledText, full: r.fullText, size: r.refsByElement.size }; });
      out.g = { distilledEqual: sNode.distilled === sLite.distilled, fullEqual: sNode.full === sLite.full, distilledEqualNoRefs: stripRefs(sNode.distilled) === stripRefs(sLite.distilled), node: sNode.distilled, lite: sLite.distilled };
      // (e) part 3: a remount, then Lite captures FIRST, then Node: both mint from their own counters.
      await page.getByRole("button", { name: "Unmount counter" }).click();
      await page.getByRole("button", { name: "Mount counter" }).click();
      await page.getByRole("button", { name: "Increment" }).waitFor();
      await page.waitForTimeout(500);
      const liteFirst = await page.evaluate(() => { const r = window.__liteB.captureAriaSnapshot(document.body); const pairs = [...r.refsByElement].map(([el, ref]) => [el.tagName, ref]); return { distilled: r.distilledText, pairs }; });
      const marksBetween = await page.evaluate(marks);
      const nodeSecond = await page.evaluate(captureFn);
      out.e_remount2 = { liteFirst: liteFirst.distilled, marksBetween, nodeSecond: nodeSecond.distilled, equal: liteFirst.distilled === nodeSecond.distilled };
      // Global duplicate check: two distinct elements with the same ref, across both maps and the page's marks.
      // (e) part 4: the page's own Lite re-captures on mutation, so it mints first above. Force the other
      // instances to mint: insert an element and capture synchronously in the same task, before the page reacts.
      out.e_forced = await page.evaluate(() => {
        const t = window.__aymeTracer;
        const main = document.querySelector("main");
        const b1 = Object.assign(document.createElement("button"), { textContent: "Tracer node-minted" });
        main.append(b1);
        const r1 = t.injected.captureAriaSnapshot(document.body);
        const b2 = Object.assign(document.createElement("button"), { textContent: "Tracer liteB-minted" });
        main.append(b2);
        const r2 = window.__liteB.captureAriaSnapshot(document.body);
        // Same experiment with a prefixed instance: frameSeq 7 gives refPrefix "f7".
        const Prefixed = t.injected.constructor;
        const p = new Prefixed(window, { browserName: "chromium", customEngines: [], frameSeq: 7, isUnderTest: false, isUtilityWorld: false, sdkLanguage: "javascript", shouldPrependErrorPrefix: false, stableRafCount: 0, testIdAttributeName: "data-testid" });
        const b3 = Object.assign(document.createElement("button"), { textContent: "Tracer prefixed-minted" });
        main.append(b3);
        const r3 = p.captureAriaSnapshot(document.body);
        const byRef = (r) => { const m = {}; for (const [el, ref] of r.refsByElement) (m[ref] ??= []).push(el.tagName + (el.textContent.startsWith("Tracer") ? `("${el.textContent}")` : "")); return Object.fromEntries(Object.entries(m).filter(([, v]) => v.length > 1)); };
        const line = (r, s) => r.fullText.split("\n").filter((l) => l.includes(s) || /^- generic.*\[ref=/.test(l)).join(" | ");
        return {
          b1Ref: b1._ariaRef?.ref, b2Ref: b2._ariaRef?.ref, b3Ref: b3._ariaRef?.ref, bodyRef: document.body._ariaRef?.ref,
          nodeMapDupes: byRef(r1), liteBMapDupes: byRef(r2), prefixedMapDupes: byRef(r3),
          nodeLines: line(r1, "Tracer"), liteBLines: line(r2, "Tracer"), prefixedLines: line(r3, "Tracer"),
          nodeDistilledTracerLine: r1.distilledText.split("\n").filter((l) => l.includes("Tracer")),
          liteBDistilledTracerLines: r2.distilledText.split("\n").filter((l) => l.includes("Tracer")),
        };
      });
      // What does ayme-ref resolve "e1" to after the forced collision? Refresh our map, then ask.
      const sForced = await page.evaluate(captureFn);
      out.e_forcedNodeRecapture = { dupes: sForced.dupes, dupTokensFull: dupTokens(sForced.full) };
      out.e_forcedResolveE1 = await page.locator("ayme-ref=e1").evaluate((el) => el.tagName + " " + el.textContent.slice(0, 30)).catch((e) => "ERR " + e.message.split("\n")[0]);
      await page.waitForTimeout(800);
      out.e_marksAfterForced = await page.evaluate(marks);
      await page.evaluate(() => document.querySelectorAll("main > button").forEach((b) => b.textContent.startsWith("Tracer") && b.remove()));
      out.e_globalDupes = await page.evaluate(() => { const by = {}; for (const e of document.querySelectorAll("*")) if (e._ariaRef) (by[e._ariaRef.ref] ??= []).push(e.tagName); return Object.entries(by).filter(([, v]) => v.length > 1); });

      // (f) timing: in-page direct, Lite B direct, Node round trip.
      out.f = await page.evaluate(() => {
        const t = window.__aymeTracer, own = [], lite = [];
        for (let i = 0; i < 10; i++) { const t0 = performance.now(); t.injected.captureAriaSnapshot(document.body); own.push(performance.now() - t0); }
        for (let i = 0; i < 10; i++) { const t0 = performance.now(); window.__liteB.captureAriaSnapshot(document.body); lite.push(performance.now() - t0); }
        return { inPageOwnMs: own, inPageLiteBMs: lite };
      });
      const rt = [], rtInner = [];
      for (let i = 0; i < 10; i++) { const t0 = performance.now(); const r = await page.evaluate(captureFn); rt.push(performance.now() - t0); rtInner.push(r.inPageMs); }
      out.f.nodeRoundTripMs = rt; out.f.nodeRoundTripInnerMs = rtInner;
      out.f.medians = { inPageOwn: median(out.f.inPageOwnMs), inPageLiteB: median(out.f.inPageLiteBMs), nodeRoundTrip: median(rt), nodeRoundTripInner: median(rtInner) };
      out.f.payloadChars = (await page.evaluate(captureFn)).full.length;
    }
    out.errors = errors;
    save();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, (k, v) => (typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v), 2));
