// Browser runtime's own answer to a full-load click: does it resolve before the document goes away?
// In-page timeline kept in sessionStorage (survives the same-tab, same-origin load).
import { writeFileSync } from "node:fs";
import { chromium, BASE, injectFixtures, recordPublishedTools, waitForPublishedTool, executePublishedTool } from "./common.mjs";
const REPS = Number(process.env.REPS ?? 5);
const rows = [];
const browser = await chromium.launch();
try {
  for (let i = 0; i < REPS; i++) for (const tool of ["click", "navigate"]) {
    const context = await browser.newContext();
    await recordPublishedTools(context);
    // Binding exposed BEFORE goto (context level): does the answer cross out of the dying document?
    let bindingAt; const tStart = { v: 0 };
    await context.exposeFunction("__b2Answer", () => { bindingAt = performance.now() - tStart.v; });
    const page = await context.newPage();
    await page.goto(`${BASE}?bullet2=bnav-${Date.now()}-${i}`);
    await waitForPublishedTool(page, "CounterPage.increment");
    await injectFixtures(page);
    await page.waitForTimeout(300);
    const snap = await executePublishedTool(page, "snapshot", {});
    const navRef = snap.structure.match(/(e\d+) button "Navigate with query"/)[1];
    const args = tool === "click" ? { target: navRef } : { url: page.url() + "&nav=1" };
    tStart.v = performance.now();
    await page.evaluate(({ tool, args }) => {
      const t0 = performance.now();
      const log = (k, v) => { const s = JSON.parse(sessionStorage.b2 || "{}"); s[k] = v ?? +(performance.now() - t0).toFixed(1); sessionStorage.b2 = JSON.stringify(s); };
      sessionStorage.b2 = "{}";
      navigation.addEventListener("navigate", (e) => log("navigateEvent"));
      addEventListener("beforeunload", () => log("beforeunload"));
      addEventListener("pagehide", () => log("pagehide"));
      document.modelContext.tools.find((c) => c.name === tool).execute(args).then(
        (v) => { window.__b2Answer(v); log("answeredAt"); log("answer", v); }, (e) => { log("thrownAt"); log("thrown", String(e)); });
    }, { tool, args });
    await page.waitForURL(/nav=1/, { waitUntil: "load" });
    const s = JSON.parse(await page.evaluate(() => sessionStorage.b2 || "{}"));
    await page.waitForTimeout(200);
    rows.push({ tool, bindingDeliveredNodeMs: bindingAt ?? null, ...s, answer: undefined });
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(new URL("./browserNav.json", import.meta.url), JSON.stringify(rows, null, 1));
for (const r of rows) console.log(JSON.stringify(r));
