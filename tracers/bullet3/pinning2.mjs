// Bullet 3c: separate the cost of locator resolution from the cost of holding handles.
import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";
const URL = "http://127.0.0.1:4191/";
const N = 500, SIZE = 100_000;
const mb = (n) => (n / 1024 / 1024).toFixed(1) + "MB";
const browser = await chromium.launch();
async function scenario(name, acquire, release) {
  const page = await browser.newPage();
  await page.goto(URL);
  await page.getByRole("region", { name: "Counter" }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable"); await cdp.send("Performance.enable");
  const mem = async () => { for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage"); const { metrics } = await cdp.send("Performance.getMetrics");
    return `heap=${mb(usedSize)} Nodes=${metrics.find((m) => m.name === "Nodes").value}`; };
  await page.evaluate(([n, s]) => { for (let i = 0; i < n; i++) { const d = document.createElement("div"); d.className = "pin"; d.textContent = String(i).padEnd(s, "x"); document.body.append(d); } }, [N, SIZE]);
  console.log(`[${name}] divs attached: ${await mem()}`);
  const t = Date.now(); const hs = await acquire(page); const dt = Date.now() - t;
  console.log(`[${name}] acquired (${dt}ms, ${hs.length} handles): ${await mem()}`);
  await page.evaluate(() => document.querySelectorAll(".pin").forEach((d) => d.remove()));
  console.log(`[${name}] divs removed, handles held: ${await mem()}`);
  if (release) { await release(hs); console.log(`[${name}] released: ${await mem()}`); }
  await page.close();
}
const disposeAll = async (hs) => { for (const h of hs) await h.dispose(); };
try {
  await scenario("A locator.nth(i).count() x500, no handles", async (p) => { for (let i = 0; i < N; i++) await p.locator(".pin").nth(i).count(); return []; });
  await scenario("B page.$$('.pin') one call", (p) => p.$$(".pin"), disposeAll);
  await scenario("C locator.nth(i).elementHandle() x500", async (p) => { const hs = []; for (let i = 0; i < N; i++) hs.push(await p.locator(".pin").nth(i).elementHandle()); return hs; }, disposeAll);
  await scenario("D page.$('.pin:nth-of-type(k)') x500", async (p) => { const hs = []; for (let i = 0; i < N; i++) hs.push(await p.$(`div.pin >> nth=${i}`)); return hs; }, disposeAll);
} finally { await browser.close(); }
