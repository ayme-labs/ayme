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

/** Opens the counter page with the recording driver and waits for publication. */
async function openCounter(context: BrowserContext, page: Page) {
  await recordPublishedTools(context);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
  );
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

    if (render === "spa")
      test("renders no counter on the server in SPA mode", async ({ page }) => {
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(
          0
        );
      });
    else
      test("renders the counter and the initial status on repeated requests", async ({
        page,
      }) => {
        for (let request = 0; request < 2; request += 1) {
          const response = await page.goto("/");
          expect(response?.status()).toBe(200);
          await expect(
            page.getByRole("region", { name: "Counter" })
          ).toBeVisible();
          await expect(page.locator("output")).toHaveText("0");
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

    test("calls the Page Object from the app, through its tool and through Playwright", async ({
      page,
    }) => {
      // The app's call runs the compiled model's action in the browser.
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(page.locator("output")).toHaveText("1");
      await executePublishedTool(page, "CounterPage.increment");
      await expect(page.locator("output")).toHaveText("2");
      await new CounterPage(page).increment();
      await expect(page.locator("output")).toHaveText("3");
    });

    test("removes the tools on unmount and registers a new instance on remount", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Unmount counter" }).click();
      await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(
        0
      );
      await expect
        .poll(() => publishedToolNames(page))
        .not.toContain("CounterPage.increment");
      await page
        .getByRole("button", { name: "Mount counter", exact: true })
        .click();
      await expect
        .poll(() => publishedToolNames(page))
        .toContain("CounterPage.increment");
      // The new instance acts on the new counter.
      await expect(page.locator("output")).toHaveText("0");
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(page.locator("output")).toHaveText("1");
    });

    if (navigation)
      test("removes the page's tools on navigation and restores them on return", async ({
        page,
      }) => {
        await page.getByRole("link", { name: navigation.away }).click();
        await expect(page.getByText(navigation.awayText)).toBeVisible();
        await expect
          .poll(() => publishedToolNames(page))
          .not.toContain("CounterPage.increment");
        await page.getByRole("link", { name: navigation.back }).click();
        await expect
          .poll(() => publishedToolNames(page))
          .toContain("CounterPage.increment");
        await expect(
          page.getByRole("status", { name: "Publication" })
        ).toHaveText("Publication: active");
        await page.getByRole("button", { name: "Call Page Object" }).click();
        await expect(page.locator("output")).toHaveText("1");
      });
  });
}

const settle = (ms: number) =>
  new Promise<true>((resolve) => setTimeout(() => resolve(true), ms));

/**
 * On the dev server, editing a type the Page Object Model imports rebuilds
 * its published schema without a restart. `counterModePath` is the app's
 * `CounterMode.ts`. Production builds do not rebuild, so the test exists only
 * on the dev server.
 */
export function devRebuildTests({
  counterModePath,
}: {
  counterModePath: string;
}) {
  if (server !== "dev") return;
  // Plain Playwright `test`: the dev server's own reloads may log errors.
  base(
    "rebuilds the published schema when an imported type changes",
    async ({ context, page }) => {
      const original = await readFile(counterModePath, "utf8");
      const changed = original.replace('"double"', '"triple"');
      expect(changed).not.toBe(original);
      await recordPublishedTools(context);
      // The dev server can reload the page at any moment, so the schema is
      // checked inside one wait, which Playwright re-runs in each new document,
      // rather than read after it.
      const waitForModeSchemaWith = (value: string) =>
        page.waitForFunction(
          (value) => {
            const { modelContext } = document as unknown as {
              modelContext: RecordingDriver;
            };
            const tool = modelContext.tools.find(
              (candidate) => candidate.name === "CounterPage.setMode"
            );
            return JSON.stringify(tool?.inputSchema ?? null).includes(value);
          },
          value,
          { timeout: 30_000 }
        );

      await page.goto("/");
      await waitForModeSchemaWith('"double"');

      try {
        await writeFile(counterModePath, changed);
        // A hot update may replace the edited module without reloading the
        // page, so the page is reloaded until it publishes the rebuilt schema.
        // When one of the dev server's own reloads aborts ours, it reloads the
        // page all the same.
        const rebuilt = waitForModeSchemaWith('"triple"');
        while (await Promise.race([rebuilt.then(() => false), settle(500)]))
          await page.reload().catch(() => {});
      } finally {
        await writeFile(counterModePath, original);
      }
    }
  );
}
