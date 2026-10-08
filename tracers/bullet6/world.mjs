import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<button id=a>Alpha</button><button id=b>Beta</button>`);
// Plant a main-world mark on Alpha, as the page's own Ayme Lite would.
await page.evaluate(() => { document.getElementById("a")._ariaRef = { role: "button", name: "Alpha", ref: "e99" }; });
const snap1 = await page.ariaSnapshot({ mode: "ai" });
const mainMarks = await page.evaluate(() => [...document.querySelectorAll("*")].filter(e => e._ariaRef).map(e => `${e.tagName}#${e.id}=${e._ariaRef.ref}`));
const snap2 = await page.ariaSnapshot({ mode: "ai" });
let resolve;
try { resolve = await page.locator("aria-ref=e99").count(); } catch (e) { resolve = "error: " + e.message.split("\n")[0]; }
console.log(JSON.stringify({ snap1, snap2, mainWorldMarksAfterSnapshot: mainMarks, ariaRefE99Count: resolve }, null, 2));
await browser.close();
