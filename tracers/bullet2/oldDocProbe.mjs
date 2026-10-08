// Can Node still evaluate in the OLD document once the navigation request is seen?
// Pre-acquired JSHandle (bound to the old execution context) vs page.evaluate vs page.ariaSnapshot.
import { chromium, BASE, injectFixtures, recordPublishedTools, waitForPublishedTool } from "./common.mjs";
const now = () => performance.now();
const browser = await chromium.launch();
try {
  for (const how of ["handle", "page.evaluate", "ariaSnapshot", "handle", "page.evaluate", "ariaSnapshot"]) {
    const context = await browser.newContext();
    await recordPublishedTools(context);
    const page = await context.newPage();
    await page.goto(`${BASE}?bullet2=probe-${Date.now()}`);
    await waitForPublishedTool(page, "CounterPage.increment");
    await injectFixtures(page);
    const h = await page.evaluateHandle(() => document);
    const t0 = now();
    const navReq = new Promise((r) => page.on("request", (q) => q.isNavigationRequest() && r(now() - t0)));
    let committed; page.on("framenavigated", () => (committed ??= now() - t0));
    const clickP = page.locator("#b2-nav").click().then(() => (clickDone = now() - t0)); let clickDone;
    const reqAt = await navReq;
    const s = now() - t0;
    let res;
    try {
      res = how === "handle" ? await h.evaluate((d) => d.location.href + " | buttons=" + d.querySelectorAll("button").length)
        : how === "page.evaluate" ? await page.evaluate(() => location.href + " | buttons=" + document.querySelectorAll("button").length)
        : (await page.ariaSnapshot({ mode: "ai" })).split("\n")[1];
    } catch (e) { res = "THROWS: " + e.message.split("\n")[0]; }
    console.log(`${how}: navRequest@${reqAt.toFixed(1)} probe start@${s.toFixed(1)} end@${(now() - t0).toFixed(1)} committed@${committed?.toFixed(1)} clickResolved@${(await clickP, clickDone).toFixed(1)} -> ${res}`);
    await context.close();
  }
} finally { await browser.close(); }
