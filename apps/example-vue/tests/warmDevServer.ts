import { chromium, type FullConfig } from "@playwright/test";
import {
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

/**
 * Loads the playground once before any test starts. Vite compiles the app's
 * modules on their first request, and on a busy CI runner that first load
 * takes long enough to run the first test that opens a page past its budget.
 * Paying it here keeps every test's budget for its own steps.
 */
export default async function warmDevServer(config: FullConfig) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: config.projects[0]!.use.baseURL,
    });
    await recordPublishedTools(context);
    const page = await context.newPage();
    // Network idle also covers the modules the app imports lazily, such as
    // the Inspector's.
    await page.goto("/", { waitUntil: "networkidle", timeout: 60_000 });
    await waitForPublishedTool(page, "ListPage.addItem", { timeout: 60_000 });
  } finally {
    await browser.close();
  }
}
