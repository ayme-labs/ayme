import { chromium, type FullConfig } from "@playwright/test";
import {
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

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
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle", timeout: 60_000 });
    await waitForPublishedTool(page, "CounterPage.increment", {
      timeout: 60_000,
    });
    await page.goto("/other", { waitUntil: "networkidle", timeout: 60_000 });
  } finally {
    await browser.close();
  }
}
