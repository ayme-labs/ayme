// changes_before over the boundary: the page drifts between the Caller's snapshot and the action.
import { chromium, BASE, injectFixtures, recordPublishedTools, waitForPublishedTool, executePublishedTool } from "./common.mjs";
import { installNodeObserver, nodeSnapshot, nodeRunAction } from "./nodeRunAction.mjs";
const drift = (page) => page.evaluate(() => { document.querySelector("#b2-para").textContent = "Drifted"; });
const browser = await chromium.launch();
try {
  { const context = await browser.newContext(); await recordPublishedTools(context);
    const page = await context.newPage(); const state = await installNodeObserver(context, page);
    await page.goto(`${BASE}?bullet2=drift-n-${Date.now()}`); await waitForPublishedTool(page, "CounterPage.increment");
    await injectFixtures(page); await page.waitForTimeout(300); await nodeSnapshot(state);
    await drift(page); await page.waitForTimeout(300);
    const r = await nodeRunAction(state, () => page.getByRole("button", { name: "Increment", exact: true }).click());
    console.log("NODE", JSON.stringify(r.result, null, 1)); await context.close(); }
  { const context = await browser.newContext(); await recordPublishedTools(context);
    const page = await context.newPage();
    await page.goto(`${BASE}?bullet2=drift-b-${Date.now()}`); await waitForPublishedTool(page, "CounterPage.increment");
    await injectFixtures(page); await page.waitForTimeout(300);
    const snap = await executePublishedTool(page, "snapshot", {});
    await drift(page); await page.waitForTimeout(300);
    const ref = snap.structure.match(/(e\d+) button "Increment"/)[1];
    console.log("BROWSER", JSON.stringify(await executePublishedTool(page, "click", { target: ref }), null, 1)); await context.close(); }
} finally { await browser.close(); }
