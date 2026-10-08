// Bullet 3d: isolate handle pinning. Each div carries a ~400KB JS array expando and an id, so
// queries by #id never read text (avoids Playwright's injected-script text caches seen in pinning2).
import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";
const URL = "http://127.0.0.1:4191/";
const N = 200;
const mb = (n) => (n / 1024 / 1024).toFixed(1) + "MB";
const browser = await chromium.launch();
async function scenario(name, holdMode) {
  const page = await browser.newPage();
  await page.goto(URL);
  await page.getByRole("region", { name: "Counter" }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable"); await cdp.send("Performance.enable");
  const mem = async () => { for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage"); const { metrics } = await cdp.send("Performance.getMetrics");
    return `heap=${mb(usedSize)} Nodes=${metrics.find((m) => m.name === "Nodes").value}`; };
  console.log(`[${name}] baseline: ${await mem()}`);
  await page.evaluate((n) => { for (let i = 0; i < n; i++) { const d = document.createElement("div"); d.id = "p" + i; d.payload = new Array(50_000).fill(i + 0.5); document.body.append(d); } }, N);
  console.log(`[${name}] ${N} divs with payload attached: ${await mem()}`);
  let hs = [];
  for (let i = 0; i < N; i++) { const h = await page.$("#p" + i); if (holdMode === "none") await h.dispose(); else hs.push(h); }
  console.log(`[${name}] after querying (${holdMode === "none" ? "each handle disposed at once" : "holding " + hs.length + " handles"}): ${await mem()}`);
  await page.evaluate(() => document.querySelectorAll("[id^=p]").forEach((d) => d.remove()));
  console.log(`[${name}] divs removed from DOM: ${await mem()}`);
  if (holdMode === "dispose") { for (const h of hs) await h.dispose(); hs = []; console.log(`[${name}] handles disposed: ${await mem()}`); }
  if (holdMode === "drop") { hs = []; for (let k = 0; k < 3; k++) { global.gc(); await new Promise((r) => setTimeout(r, 300)); } console.log(`[${name}] handles dropped in Node, no dispose, node gc x3: ${await mem()}`); }
  await page.close();
}
try { await scenario("control", "none"); await scenario("held", "dispose"); await scenario("held-drop", "drop"); } finally { await browser.close(); }
