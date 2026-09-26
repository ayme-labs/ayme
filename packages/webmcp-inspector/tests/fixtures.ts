import { test as base, selectors, type Page } from "@playwright/test";

import { Inspector, registerInspectorSelectors } from "../src/testing";
import { ListPage } from "./fixture/ListPage";

export { expect } from "@playwright/test";

/** A fixture page: the list app with its Page Object, the runtime and the Inspector. */
export type FixturePage = "/" | "/react.html";

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the browser lacks WebMCP, the page's script broke or the
 * runtime never published its tools.
 */
export async function openFixture(page: Page, path: FixturePage) {
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  await page.goto(path);

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

/** Calls a published tool as an agent does, over Chromium's WebMCP. */
export async function callTool(page: Page, name: string, args: unknown) {
  return page.evaluate(
    async ({ name, args }) => {
      type Tool = { name: string };
      const context = document.modelContext as unknown as {
        getTools(): Promise<Tool[]>;
        executeTool(tool: Tool, input: string): Promise<string | null>;
      };
      const tool = (await context.getTools()).find(
        (candidate) => candidate.name === name
      );
      if (!tool) throw new Error(`${name} is not published.`);
      return JSON.parse(
        (await context.executeTool(tool, JSON.stringify(args))) ?? "null"
      ) as unknown;
    },
    { name, args }
  );
}

export const test = base.extend<
  {
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
