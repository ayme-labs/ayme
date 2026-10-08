import { test as base, selectors, type Page } from "@playwright/test";
import { recordPublishedTools } from "@ayme-dev/ayme/testing";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import { ListPage } from "../pom/ListPage";

export { expect } from "@playwright/test";

/**
 * A fixture page: the list app with its Page Object, the runtime and the
 * Inspector. "/models.html" has other Page Objects; "/unpublished.html" is
 * the list app with WebMCP publication off; "/late.html" mounts the Inspector
 * in demo mode after the runtime started; "/session.html" mounts it through
 * the session's `inspector` option, in demo mode with "?demo"; "/dogfood.html"
 * mounts it for dogfooding, with the Inspector's own Page Object registered.
 */
export type FixturePage =
  | "/"
  | "/react.html"
  | "/models.html"
  | "/unpublished.html"
  | "/late.html"
  | "/session.html"
  | "/session.html?demo"
  | "/dogfood.html";

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the page's script broke or the runtime never published its
 * tools.
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

  // Without publication the runtime stays "disabled"; otherwise it publishes.
  const runtimeState = path === "/unpublished.html" ? "disabled" : "active";
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
  // `@ayme-dev/ayme/testing`, which the tests call tools through.
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
