import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  const urls = [];
  page.on("request", (r) => { if (/playwright-lite|locator-|internal/.test(r.url())) urls.push(r.url()); });
  await page.goto("http://127.0.0.1:4191/");
  await page.getByRole("button", { name: "Increment" }).waitFor();
  await page.waitForTimeout(1500);
  console.log(urls.join("\n"));
  console.log("marks", await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e._ariaRef).map((e) => e.tagName + ":" + e._ariaRef.ref).join(" ")));
} finally { await browser.close(); }
