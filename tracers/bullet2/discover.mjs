import { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";
import { recordPublishedTools, publishedToolNames, waitForPublishedTool, executePublishedTool, publishedToolSchema } from "../../packages/ayme/dist/testing.mjs";
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await recordPublishedTools(context);
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4191/?bullet2=discover");
  await waitForPublishedTool(page, "snapshot").catch(e=>console.log("no snapshot tool", e.message));
  await page.waitForTimeout(1000);
  const names = await publishedToolNames(page);
  console.log(names);
  for (const n of names) { const s = await publishedToolSchema(page, n); console.log("==", n, s.description.slice(0,300), JSON.stringify(s.inputSchema).slice(0,400)); }
  console.log(await page.ariaSnapshot({ mode: "ai" }));
} finally { await browser.close(); }
