// Bullet 3b: does a held ElementHandle pin a detached node in the renderer? Fresh page per scenario.
import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";

const URL = "http://127.0.0.1:4191/";
const N = 500, SIZE = 100_000; // 500 detached divs x 100k chars (~50 MB of one-byte strings)
const mb = (n) => (n / 1024 / 1024).toFixed(1) + "MB";
const nodeMem = () => { global.gc(); const m = process.memoryUsage(); return `rss=${mb(m.rss)} heapUsed=${mb(m.heapUsed)}`; };

const browser = await chromium.launch();
async function scenario(name, mode) {
  const page = await browser.newPage();
  await page.goto(URL);
  await page.getByRole("region", { name: "Counter" }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Performance.enable");
  const mem = async () => {
    for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return `heap=${mb(usedSize)} Nodes=${m.Nodes} JSEventListeners=${m.JSEventListeners}`;
  };
  console.log(`[${name}] baseline renderer ${await mem()} | node ${nodeMem()}`);
  await page.evaluate(([n, s]) => { for (let i = 0; i < n; i++) { const d = document.createElement("div"); d.className = "pin"; d.textContent = String(i).padEnd(s, "x"); document.body.append(d); } }, [N, SIZE]);
  let handles = [];
  if (mode !== "none") for (let i = 0; i < N; i++) handles.push(await page.locator(".pin").nth(i).elementHandle());
  console.log(`[${name}] divs attached${mode !== "none" ? " + 500 handles" : ""}: renderer ${await mem()} | node ${nodeMem()}`);
  await page.evaluate(() => document.querySelectorAll(".pin").forEach((d) => d.remove()));
  console.log(`[${name}] divs removed from DOM: renderer ${await mem()} | node ${nodeMem()}`);
  if (mode === "dispose") { for (const h of handles) await h.dispose(); handles = []; console.log(`[${name}] handles disposed: renderer ${await mem()} | node ${nodeMem()}`); }
  if (mode === "drop") { handles = []; global.gc(); await new Promise((r) => setTimeout(r, 500)); global.gc(); console.log(`[${name}] handles dropped in Node (no dispose) + node gc: renderer ${await mem()} | node ${nodeMem()}`); }
  if (mode === "reload") { await page.reload(); await page.getByRole("region", { name: "Counter" }).waitFor(); console.log(`[${name}] page.reload with handles held: renderer ${await mem()} | node ${nodeMem()}`); }
  await page.close();
}
try {
  await scenario("control-no-handles", "none");
  await scenario("held-then-dispose", "dispose");
  await scenario("held-then-drop", "drop");
  await scenario("held-then-reload", "reload");
} finally { await browser.close(); }
