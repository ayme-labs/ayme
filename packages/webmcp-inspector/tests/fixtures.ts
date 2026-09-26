import { test as base, type Page } from "@playwright/test";

import { Inspector } from "../src/testing";
import { ListPage } from "./fixture/ListPage";

export { expect } from "@playwright/test";

/** A fixture page: the list app with its Page Object, the runtime and the Inspector. */
export type FixturePage = "/" | "/react.html";

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the browser lacks WebMCP, the page's script broke or the
 * runtime never published its tools.
 */
export async function openFixture(
  page: Page,
  path: FixturePage,
  { reload = false } = {}
) {
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  if (reload) await page.reload();
  else await page.goto(path);

  const hasWebMcp = await page.evaluate(
    () =>
      typeof (document.modelContext as { executeTool?: unknown } | undefined)
        ?.executeTool === "function"
  );
  if (!hasWebMcp)
    throw new Error(
      "Chromium runs without native WebMCP: launch it with --enable-features=WebMCP,WebMCPTesting."
    );

  const root = page.locator("html");
  try {
    await root.and(page.locator("[data-fixture]")).waitFor({ timeout: 10_000 });
  } catch {
    throw new Error(
      `The fixture page ${path} never ran its script. ${pageErrors.join("; ")}`
    );
  }
  if ((await root.getAttribute("data-fixture")) !== "ready")
    throw new Error(
      `The fixture page ${path} failed to start: ${await root.getAttribute("data-fixture-error")}`
    );

  try {
    await root
      .and(page.locator('[data-runtime="active"]'))
      .waitFor({ timeout: 10_000 });
  } catch {
    throw new Error(
      `The Ayme runtime did not publish its tools: ${await root.getAttribute("data-runtime-message")}`
    );
  }

  page.off("pageerror", onPageError);
  return { inspector: new Inspector(page), listPage: new ListPage(page) };
}

export const test = base.extend<{
  fixturePath: FixturePage;
  opened: Awaited<ReturnType<typeof openFixture>>;
  inspector: Inspector;
  listPage: ListPage;
}>({
  fixturePath: ["/", { option: true }],
  opened: async ({ page, fixturePath }, use) => {
    await use(await openFixture(page, fixturePath));
  },
  inspector: async ({ opened }, use) => {
    await use(opened.inspector);
  },
  listPage: async ({ opened }, use) => {
    await use(opened.listPage);
  },
});
