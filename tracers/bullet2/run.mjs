// Bullet 2 main run: three actions, Node vs browser, 5 reps each; latency log; error texts.
import { writeFileSync } from "node:fs";
import {
  chromium, BASE, injectFixtures, recordPublishedTools, waitForPublishedTool, executePublishedTool,
  aiCapture, waitForSettled, SETTLED_PAGE_QUIET_MS, SETTLED_PAGE_DEADLINE_MS,
} from "./common.mjs";
import { installNodeObserver, nodeSnapshot, nodeRunAction, now } from "./nodeRunAction.mjs";

const REPS = Number(process.env.REPS ?? 5);
const out = { node: {}, browser: {}, latency: [], errors: {}, navExtra: [] };
let tagN = 0;
const tag = (s) => `${s}-${Date.now()}-${++tagN}`;

async function freshNode(browser, name) {
  const context = await browser.newContext();
  await recordPublishedTools(context);
  const page = await context.newPage();
  const state = await installNodeObserver(context, page);
  await page.goto(`${BASE}?bullet2=${tag(name)}`);
  await waitForPublishedTool(page, "CounterPage.increment");
  await injectFixtures(page);
  await page.waitForTimeout(300); // let the injection's own activity pass
  await nodeSnapshot(state);
  return { context, page, state };
}
async function freshBrowser(browser, name) {
  const context = await browser.newContext();
  await recordPublishedTools(context);
  const page = await context.newPage();
  await page.goto(`${BASE}?bullet2=${tag(name)}`);
  await waitForPublishedTool(page, "CounterPage.increment");
  await injectFixtures(page);
  await page.waitForTimeout(300);
  const snap = await executePublishedTool(page, "snapshot", {});
  const refOf = (re) => snap.structure.match(re)?.[1];
  const refs = {
    increment: refOf(/(e\d+) button "Increment"/), unmount: refOf(/(e\d+) button "Unmount counter"/),
    nav: refOf(/(e\d+) button "Navigate with query"/), disabled: refOf(/(e\d+) button "Disabled action"/),
    para: refOf(/(e\d+) paragraph: Plain paragraph/),
  };
  return { context, page, refs };
}
async function timed(fn) { const t0 = now(); try { const r = await fn(); return { ms: now() - t0, r }; } catch (e) { return { ms: now() - t0, error: e.message }; } }
const push = (side, key, v) => ((out[side][key] ??= []).push(v));

const browser = await chromium.launch();
try {
  for (let i = 0; i < REPS; i++) {
    // --- increment
    { const { context, page, state } = await freshNode(browser, "n-inc");
      const r = await nodeRunAction(state, () => page.getByRole("button", { name: "Increment", exact: true }).click());
      push("node", "increment", { result: r.result, timing: r.timing, window: r.window });
      await context.close(); }
    { const { context, page, refs } = await freshBrowser(browser, "b-inc");
      const t = await timed(() => executePublishedTool(page, "click", { target: refs.increment }));
      push("browser", "increment", { result: t.r, error: t.error, ms: t.ms });
      await context.close(); }
    // --- toggle: unmount then mount, same page
    { const { context, page, state } = await freshNode(browser, "n-tog");
      const un = await nodeRunAction(state, () => page.getByRole("button", { name: "Unmount counter" }).click());
      const mo = await nodeRunAction(state, () => page.getByRole("button", { name: "Mount counter" }).click());
      push("node", "unmount", { result: un.result, timing: un.timing, window: un.window });
      push("node", "mount", { result: mo.result, timing: mo.timing });
      out.latency.push({ rep: i, unmount: { t: un.timing, window: un.window }, mount: { t: mo.timing, window: mo.window } });
      await context.close(); }
    { const { context, page, refs } = await freshBrowser(browser, "b-tog");
      const un = await timed(() => executePublishedTool(page, "click", { target: refs.unmount }));
      // Mount: the toggle button keeps its element; the browser tool takes the same ref.
      const mountRef = un.r?.changes?.match(/(e\d+) <added> button "Mount counter"/)?.[1];
      const mo = await timed(() => executePublishedTool(page, "click", { target: mountRef }));
      push("browser", "unmount", { result: un.r, error: un.error, ms: un.ms });
      push("browser", "mount", { result: mo.r, error: mo.error, ms: mo.ms });
      await context.close(); }
    // --- navigating action
    for (const loadingAfter of ["capture", "latest"]) { const { context, page, state } = await freshNode(browser, "n-nav");
      const r = await nodeRunAction(state, () => page.locator("#b2-nav").click(), { loadingAfter });
      const extra = { afterCaptureError: r.afterCaptureError };
      // Node-only: follow the load, confirm the watcher re-armed in the new document, settle there.
      const t0 = now();
      await page.waitForURL(/nav=1/, { waitUntil: "load" });
      extra.loadEventAfterAnswer = now() - t0;
      const newToken = await page.evaluate(() => window.__b2Token);
      extra.rearmed = newToken !== r.token;
      extra.armedBatchSeen = state.log.some((m) => m.token === newToken && m.events.some((e) => e[1] === "armed"));
      const { stable } = await waitForSettled({
        activity: { subscribe(on) { const l = (m) => { if (m.token === newToken) on(); }; state.listeners.add(l); return () => state.listeners.delete(l); } },
        clock: { now: () => performance.now() }, quietMs: SETTLED_PAGE_QUIET_MS, deadlineMs: SETTLED_PAGE_DEADLINE_MS,
      });
      extra.newDocSettled = stable; extra.newDocSettledAfterAnswer = now() - t0;
      extra.newUrl = page.url();
      extra.settlePromiseOutcome = await r.settledP.then(() => "resolved", (e) => "rejected: " + e.message.split("\n")[0]);
      push("node", "navigate_" + loadingAfter, { result: r.result, timing: r.timing, afterCaptureError: r.afterCaptureError, window: r.window });
      out.navExtra.push({ loadingAfter, ...extra });
      await context.close(); }
    { const { context, page, refs } = await freshBrowser(browser, "b-nav");
      // The answer is delivered through a binding the moment the tool resolves, since page.evaluate
      // loses its result once the document goes away.
      let resolveAnswer; const answer = new Promise((r) => (resolveAnswer = r));
      await page.exposeFunction("__b2Answer", (v) => resolveAnswer({ v, at: now() }));
      const t0 = now();
      const ev = page.evaluate(({ target }) => {
        const tool = document.modelContext.tools.find((c) => c.name === "click");
        tool.execute({ target }).then((v) => window.__b2Answer(v), (e) => window.__b2Answer({ thrown: String(e) }));
      }, { target: refs.nav }).catch((e) => "evaluate: " + e.message);
      let navAt; page.on("framenavigated", (f) => { if (f === page.mainFrame()) navAt ??= now() - t0; });
      const got = await Promise.race([answer, page.waitForTimeout(5000).then(() => null)]);
      await page.waitForLoadState("load").catch(() => {});
      push("browser", "navigate", { result: got?.v, answeredMs: got ? got.at - t0 : null, framenavigatedMs: navAt, evaluate: await ev, urlAfter: page.url() });
      await context.close(); }
  }
  // --- errors: disabled click, fill non-fillable
  { const { context, page } = await freshNode(browser, "n-err");
    out.errors.nodeDisabledClick = await timed(() => page.locator("#b2-disabled").click({ timeout: 2000 }));
    out.errors.nodeDisabledClickByRole = await timed(() => page.getByRole("button", { name: "Disabled action" }).click({ timeout: 2000 }));
    out.errors.nodeFillParagraph = await timed(() => page.locator("#b2-para").fill("x", { timeout: 2000 }));
    await context.close(); }
  { const { context, page, refs } = await freshBrowser(browser, "b-err");
    out.errors.browserDisabledClick = await timed(() => executePublishedTool(page, "click", { target: refs.disabled }));
    out.errors.browserFillParagraph = await timed(() => executePublishedTool(page, "fill", { target: refs.para, text: "x" }));
    await context.close(); }
} finally { await browser.close(); }
writeFileSync(new URL("./out.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("done");
