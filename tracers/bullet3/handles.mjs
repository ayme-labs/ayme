// Bullet 3: ElementHandle as Page Object Root identity, real Playwright vs example-react.
import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";

const URL = "http://127.0.0.1:4191/";
const log = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
const tryIt = async (k, fn) => { try { log(k, await fn()); } catch (e) { log(k + " THREW", e.message.split("\n").slice(0, 3).join(" | ")); } };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(URL);
  const region = page.getByRole("region", { name: "Counter" });
  await region.waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const rendererMem = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const pm = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);
    return { JSHeapUsedSize: mb(m.JSHeapUsedSize), Nodes: m.Nodes, perfMemoryUsed: pm ? mb(pm) : null };
  };

  // 1. identity vs document.querySelector
  const h = await region.elementHandle();
  log("1 handle toString", String(h));
  await tryIt("1 h === querySelector('section[aria-label=Counter]')", () =>
    page.evaluate((el) => el === document.querySelector('section[aria-label="Counter"]'), h));

  // 2. two handles same element
  const h2 = await region.elementHandle();
  const h3 = await page.$('section[aria-label="Counter"]');
  await tryIt("2 h === h2 in-page (both locator.elementHandle)", () => page.evaluate(([a, b]) => a === b, [h, h2]));
  await tryIt("2 h === h3 in-page (page.$)", () => page.evaluate(([a, b]) => a === b, [h, h3]));
  log("2 h === h2 in Node (object identity)", h === h2);

  // 2b. React re-render without unmount
  const out = await region.locator("output").elementHandle();
  const before = await out.evaluate((el) => el.textContent);
  await region.getByRole("button", { name: "Increment" }).click();
  await page.waitForFunction(() => document.querySelector("output")?.textContent === "1");
  await tryIt("2b after Increment: section handle still === querySelector", () =>
    page.evaluate((el) => el === document.querySelector('section[aria-label="Counter"]') && el.isConnected, h));
  await tryIt("2b after Increment: output handle still same node", () =>
    out.evaluate((el, b) => ({ before: b, now: el.textContent, isConnected: el.isConnected, same: el === document.querySelector("output") }), before));
  await tryIt("2b fresh locator.elementHandle() === old h", async () => {
    const fresh = await region.elementHandle();
    const r = await page.evaluate(([a, b]) => a === b, [h, fresh]);
    await fresh.dispose();
    return r;
  });

  // 3. unmount
  await page.getByRole("button", { name: "Unmount counter" }).click();
  await region.waitFor({ state: "detached" });
  await tryIt("3 after unmount h.evaluate(el => el.isConnected)", () => h.evaluate((el) => el.isConnected));
  await tryIt("3 after unmount h.evaluate(el => el.getAttribute('aria-label'))", () => h.evaluate((el) => el.getAttribute("aria-label")));
  await tryIt("3 after unmount h.isVisible()", () => h.isVisible());
  await tryIt("3 after unmount h.textContent()", () => h.textContent());
  await tryIt("3 after unmount h.click({timeout:1000})", () => h.click({ timeout: 1000 }).then(() => "clicked"));
  // remount: new node?
  await page.getByRole("button", { name: "Mount counter" }).click();
  await region.waitFor();
  await tryIt("3 after remount old h === new section", () =>
    page.evaluate((el) => el === document.querySelector('section[aria-label="Counter"]'), h));
  await tryIt("3 after remount old h isConnected", () => h.evaluate((el) => el.isConnected));

  // 4. reload
  const hr = await region.elementHandle();
  await page.reload();
  await region.waitFor();
  await tryIt("4 after reload hr.evaluate(el => el.isConnected)", () => hr.evaluate((el) => el.isConnected));
  await tryIt("4 after reload page.evaluate(el => el, hr)", () => page.evaluate((el) => !!el, hr));
  await tryIt("4 after reload hr.isVisible()", () => hr.isVisible());
  await tryIt("4 after reload hr.dispose()", () => hr.dispose().then(() => "ok"));

  // 5. dispose
  const hd = await region.elementHandle();
  await hd.dispose();
  await tryIt("5 after dispose hd.evaluate(el => el.isConnected)", () => hd.evaluate((el) => el.isConnected));
  await tryIt("5 after dispose page.evaluate(el => !!el, hd)", () => page.evaluate((el) => !!el, hd));
  await tryIt("5 after dispose hd.dispose() again", () => hd.dispose().then(() => "ok"));
  await tryIt("5 after dispose hd.isVisible()", () => hd.isVisible());

  // 6. 500 handles
  const nodeRss = () => { global.gc?.(); return mb(process.memoryUsage().rss); };
  const nodeHeap = () => mb(process.memoryUsage().heapUsed);
  log("6 baseline node rss / heapUsed", [nodeRss(), nodeHeap()]);
  log("6 baseline renderer", await rendererMem());
  let t = Date.now();
  const many = [];
  for (let i = 0; i < 500; i++) many.push(await region.elementHandle());
  log("6 time to create 500 (ms)", Date.now() - t);
  log("6 holding 500 node rss / heapUsed", [nodeRss(), nodeHeap()]);
  log("6 holding 500 renderer", await rendererMem());
  await tryIt("6 all 500 === each other in-page", () => page.evaluate((els) => els.every((e) => e === els[0]), many));
  t = Date.now();
  for (const x of many) await x.dispose();
  log("6 time to dispose 500 (ms)", Date.now() - t);
  log("6 after dispose node rss / heapUsed", [nodeRss(), nodeHeap()]);
  log("6 after dispose renderer", await rendererMem());

  // 6b. pinning: does a held handle keep a detached node alive in the renderer?
  // create 500 detached divs with 100KB of text each; hold handles; remove from DOM; GC; measure.
  const pin = await page.evaluate(() => { for (let i = 0; i < 500; i++) { const d = document.createElement("div"); d.className = "pin"; d.textContent = "x".repeat(100_000); document.body.append(d); } return document.querySelectorAll(".pin").length; });
  log("6b created big divs", pin);
  const pinned = [];
  for (let i = 0; i < 500; i++) pinned.push(await page.locator(".pin").nth(i).elementHandle());
  log("6b with 500 big divs attached + handles renderer", await rendererMem());
  await page.evaluate(() => document.querySelectorAll(".pin").forEach((d) => d.remove()));
  log("6b big divs removed, handles held renderer", await rendererMem());
  for (const x of pinned) await x.dispose();
  log("6b handles disposed renderer", await rendererMem());
} finally {
  await browser.close();
}
