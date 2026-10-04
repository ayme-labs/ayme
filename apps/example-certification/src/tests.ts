import { readFile, writeFile } from "node:fs/promises";

import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/ayme/testing";

import { render, server } from "./config";

/**
 * Playwright's `test`, failing any test whose page throws, logs a console
 * error or warns about hydration. An example's own specs use it too.
 */
export const test = base.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || /hydrat/i.test(message.text()))
          errors.push(message.text());
      });
      await use();
      expect(
        errors,
        "page errors, console errors and hydration warnings"
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const count = (page: Page) =>
  page.getByRole("region", { name: "Counter" }).locator("output");

/** The published tools of the counter's Page Objects, sorted. */
const counterTools = async (page: Page) =>
  (await publishedToolNames(page))
    .filter((name) => /^(Sub)?CounterPage\./.test(name))
    .sort();

const allCounterTools = [
  "CounterPage.increment",
  "CounterPage.setMode",
  "SubCounterPage.increment",
  "SubCounterPage.setMode",
];

/** Opens the counter page with the recording driver and waits for publication. */
async function openCounter(context: BrowserContext, page: Page) {
  await recordPublishedTools(context);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
  );
  await expect(count(page)).toHaveText("0");
}

/** The schemas the compiler derives from the counter's Page Object Model. */
const counterSchemas = (pom: string) => [
  {
    name: `${pom}.increment`,
    description: "Increment the counter.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: `${pom}.setMode`,
    description: "Set counter mode metadata.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["single", "double"] } },
      required: ["mode"],
      additionalProperties: false,
    },
  },
];

/**
 * The counter page without JavaScript: server-rendered with the initial
 * publication status, or empty in SPA mode.
 */
export function serverRenderTests() {
  test.describe("server render", () => {
    test.use({ javaScriptEnabled: false });

    test("renders no counter on the server in SPA mode", async ({ page }) => {
      test.skip(render !== "spa", "Server rendering is on.");
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(
        0
      );
    });
    test("renders the counter and the initial status on repeated requests", async ({
      page,
    }) => {
      test.skip(render === "spa", "SPA mode renders no server HTML.");
      for (let request = 0; request < 2; request += 1) {
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        await expect(
          page.getByRole("region", { name: "Counter" })
        ).toBeVisible();
        await expect(count(page)).toHaveText("0");
        await expect(
          page.getByRole("status", { name: "Publication" })
        ).toHaveText("Publication: waiting");
        await expect(
          page.getByRole("button", { name: "Call Page Object" })
        ).toBeVisible();
      }
    });
  });
}

/**
 * The counter page in the browser: publication, the compiled tools, the three
 * ways to call the Page Object, and registration following the counter's
 * lifetime. `CounterPage` is the app's own compiled model, used through real
 * Playwright. `navigation`, for an app with a second page, names the links
 * that leave the counter page and return to it.
 */
export function counterTests({
  CounterPage,
  navigation,
}: {
  CounterPage: new (page: Page) => { increment(): Promise<void> };
  navigation?: { away: string; awayText: string; back: string };
}) {
  test.describe("counter", () => {
    test.beforeEach(({ context, page }) => openCounter(context, page));

    test("publishes the Page Object's tools with their compiled schemas", async ({
      page,
    }) => {
      for (const schema of counterSchemas("CounterPage"))
        await expect
          .poll(() => publishedToolSchema(page, schema.name))
          .toEqual(schema);
    });

    test("publishes an undecorated subclass of a Page Object Model", async ({
      page,
    }) => {
      for (const schema of counterSchemas("SubCounterPage"))
        await expect
          .poll(() => publishedToolSchema(page, schema.name))
          .toEqual(schema);
    });

    test("publishes Ayme's own tools", async ({ page }) => {
      await expect
        .poll(() => publishedToolNames(page))
        .toContain("CounterPage.increment");
      // Every published name without a Page Object's dot.
      expect(
        (await publishedToolNames(page)).filter((name) => !name.includes("."))
      ).toEqual([
        "snapshot",
        "click",
        "hover",
        "type",
        "fill",
        "check",
        "uncheck",
        "select_option",
        "fill_form",
        "press_key",
      ]);
    });

    test("runs the Page Object's action when the app calls it", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(count(page)).toHaveText("1");
    });

    test("runs the Page Object's action through its published tool", async ({
      page,
    }) => {
      await executePublishedTool(page, "CounterPage.increment");
      await expect(count(page)).toHaveText("1");
    });

    test("runs the same Page Object Model through Playwright", async ({
      page,
    }) => {
      await new CounterPage(page).increment();
      await expect(count(page)).toHaveText("1");
    });

    test("removes the tools on unmount and registers a new instance on remount", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Unmount counter" }).click();
      await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(
        0
      );
      await expect.poll(() => counterTools(page)).toEqual([]);
      await page
        .getByRole("button", { name: "Mount counter", exact: true })
        .click();
      await expect.poll(() => counterTools(page)).toEqual(allCounterTools);
      // The new instance acts on the new counter.
      await expect(count(page)).toHaveText("0");
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(count(page)).toHaveText("1");
    });

    test("removes the page's tools on navigation and restores them on return", async ({
      page,
    }) => {
      if (!navigation) return test.skip(true, "The app has one page.");
      await page.getByRole("link", { name: navigation.away }).click();
      await expect(page.getByText(navigation.awayText)).toBeVisible();
      await expect.poll(() => counterTools(page)).toEqual([]);
      await page.getByRole("link", { name: navigation.back }).click();
      await expect.poll(() => counterTools(page)).toEqual(allCounterTools);
      await expect(
        page.getByRole("status", { name: "Publication" })
      ).toHaveText("Publication: active");
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(count(page)).toHaveText("1");
    });
  });
}

/**
 * On the dev server, editing a type the Page Object Model imports rebuilds
 * its published schema without a restart. `counterModePath` is the app's
 * `CounterMode.ts`.
 */
export function devRebuildTests({
  counterModePath,
}: {
  counterModePath: string;
}) {
  // Plain Playwright `test`: the dev server's own reloads may log errors.
  base.describe("dev rebuild", () => {
    let original: string | undefined;
    // A hook, unlike a `finally` in the test, also runs after a timeout.
    base.afterEach(async () => {
      if (original !== undefined) await writeFile(counterModePath, original);
    });

    base(
      "rebuilds the published schema when an imported type changes",
      async ({ context, page }) => {
        base.skip(server !== "dev", "Production builds do not rebuild.");
        original = await readFile(counterModePath, "utf8");
        const changed = original.replace('"double"', '"triple"');
        expect(changed).not.toBe(original);
        await recordPublishedTools(context);
        // The dev server can reload the page at any moment, so the schema is
        // read inside one wait, which Playwright re-runs in each new document
        // until one has published it.
        const publishedModeSchema = () =>
          page
            .waitForFunction(
              () => {
                const { modelContext } = document as unknown as {
                  modelContext: RecordingDriver;
                };
                const tool = modelContext.tools.find(
                  (candidate) => candidate.name === "CounterPage.setMode"
                );
                return tool ? JSON.stringify(tool.inputSchema) : "";
              },
              undefined,
              { timeout: 30_000 }
            )
            .then((schema) => schema.jsonValue());

        await page.goto("/");
        expect(await publishedModeSchema()).toContain('"double"');

        await writeFile(counterModePath, changed);
        // A hot update may replace the edited module without reloading the
        // page, so the page is reloaded until it publishes the rebuilt schema.
        // The load event fires before the app's modules run, so each document
        // is given until it publishes; reloading on a timer instead can cut
        // every document short on a slow runner. When one of the dev server's
        // own reloads aborts ours, it reloads the page all the same.
        while (!(await publishedModeSchema()).includes('"triple"'))
          await page.reload().catch(() => {});
      }
    );
  });
}
