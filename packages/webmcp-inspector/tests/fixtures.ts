import { test as base, selectors, type Page } from "@playwright/test";
import { recordPublishedTools } from "@ayme-dev/webmcp/testing";

import { unpublishedBaseURL } from "../playwright.config";
import { Inspector, registerInspectorSelectors } from "../src/testing";
import { ListPage } from "./fixture/ListPage";

export { expect } from "@playwright/test";

/** A fixture page: the list app with its Page Object, the runtime and the Inspector. */
export type FixturePage = "/" | "/react.html";

/**
 * The same list app served with WebMCP publication off, as a dev server
 * without `publish: true` serves it (tests/fixture/vite.unpublished.config.ts).
 */
export const unpublishedFixtureUrl = `${unpublishedBaseURL}/`;

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the page's script broke or the runtime never published its
 * tools.
 */
export async function openFixture(
  page: Page,
  path: FixturePage | typeof unpublishedFixtureUrl,
  { reload = false } = {}
) {
  // The unpublished page's runtime runs, but never publishes.
  const runtimeState = path === unpublishedFixtureUrl ? "disabled" : "active";
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  if (reload) await page.reload();
  else await page.goto(path);

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
      .and(page.locator(`[data-runtime="${runtimeState}"]`))
      .waitFor({ timeout: 10_000 });
  } catch {
    throw new Error(
      `The Ayme runtime did not reach "${runtimeState}": ${await root.getAttribute("data-runtime")}, ${await root.getAttribute("data-runtime-message")}`
    );
  }

  page.off("pageerror", onPageError);
  return { inspector: new Inspector(page), listPage: new ListPage(page) };
}

export const test = base.extend<
  {
    publishedTools: void;
    fixturePath: FixturePage;
    opened: Awaited<ReturnType<typeof openFixture>>;
    inspector: Inspector;
    listPage: ListPage;
  },
  { inspectorSelectors: void }
>({
  // The mounted Inspector lives in a closed shadow root; this engine is how
  // the page objects reach it on Playwright. Registered before any page.
  inspectorSelectors: [
    // Playwright reads a fixture's dependencies from this pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await registerInspectorSelectors(selectors);
      await use();
    },
    { scope: "worker", auto: true },
  ],
  // The runtime publishes to the recording WebMCP driver from
  // `@ayme-dev/webmcp/testing`, which the tests call tools through.
  publishedTools: [
    async ({ context }, use) => {
      await recordPublishedTools(context);
      await use();
    },
    { auto: true },
  ],
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
