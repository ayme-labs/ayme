import {
  chromium,
  type BrowserContext,
  type FullConfig,
} from "@playwright/test";
import {
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/webmcp/testing";
import { ignoreAutoPairScan } from "@ayme-dev/mcp/testing";

import { counterPath } from "./config";

/**
 * Loads the counter page and `/other` once before any test starts. The dev
 * server compiles each page's modules on its first request, and on a busy CI
 * runner that first load takes long enough to run the first test that opens
 * the page past its budget. Paying it here keeps every test's budget for its
 * own steps.
 */
export default async function warmDevServer(config: FullConfig) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: config.projects[0]!.use.baseURL,
    });
    await recordPublishedTools(context);
    await ignoreAutoPairScan(context);
    const page = await context.newPage();
    // The published tool shows the app's modules loaded.
    await page.goto(counterPath(), { timeout: 60_000 });
    await waitForPublishedTool(page, "CounterPage.increment", {
      timeout: 60_000,
    });
    await loadOther(context);
  } finally {
    await browser.close();
  }
}

/**
 * Loads `/other`, asking again from a new page when the dev server never
 * answers. Nuxt's dev server (Nitro 2) forwards a page request to its worker
 * on a pooled connection; a request sent just as the worker closes that
 * connection for idleness is lost without an error, so the browser waits for
 * good. A lost request never commits, while a healthy one commits well within
 * 15 s even when the server compiles the page for the first time, and a new
 * request gets a new connection.
 */
async function loadOther(context: BrowserContext) {
  for (let attempt = 1; ; attempt++) {
    const page = await context.newPage();
    try {
      await page.goto("/other", { waitUntil: "commit", timeout: 15_000 });
    } catch (error) {
      // While open, the stuck page holds the browser's cache entry for `/other`.
      await page.close();
      if (attempt === 3) throw error;
      continue;
    }
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
    return;
  }
}
