import { expect, test, type Page } from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

// The app reads ?publication and ?toolNamePrefix into provideAyme's options.
const status = (page: Page) =>
  page.getByRole("status", { name: "Publication" });

// Clicks before hydration are lost, so retry until the Page Object answers.
async function callPageObjectOnceLive(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Call Page Object" }).click();
    await expect(page.locator("output")).not.toHaveText("0", {
      timeout: 1_000,
    });
  }).toPass();
}

test("leaves publication off unless webMCP.enabled is set", async ({
  context,
  page,
}) => {
  await recordPublishedTools(context);

  await page.goto("/?publication=off");
  await expect(status(page)).toHaveText("Publication: disabled");
  await callPageObjectOnceLive(page);

  await expect(status(page)).toHaveText("Publication: disabled");
  expect(await publishedToolNames(page)).toEqual([]);
});

test("prefixes the published tool names with webMCP.toolNamePrefix", async ({
  context,
  page,
}) => {
  await recordPublishedTools(context);

  await page.goto("/?toolNamePrefix=demo_");
  await waitForPublishedTool(page, "demo_CounterPage.increment");

  const names = await publishedToolNames(page);
  expect(names.length).toBeGreaterThan(1);
  for (const name of names) expect(name).toMatch(/^demo_/);
  await executePublishedTool(page, "demo_CounterPage.increment");
  await expect(page.locator("output")).toHaveText("1");
});

test("publishes after retryPublication once a late driver appears", async ({
  page,
}) => {
  await page.goto("/");
  await expect(status(page)).toHaveText("Publication: unavailable", {
    timeout: 15_000,
  });

  // A reduced copy of the recording driver in @ayme-dev/ayme/testing, which
  // installs only before load; this one arrives late.
  await page.evaluate(() => {
    const tools: { name: string }[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: false,
      value: {
        tools,
        async registerTool(
          tool: { name: string },
          { signal }: { signal: AbortSignal }
        ) {
          tools.push(tool);
          signal.addEventListener(
            "abort",
            () => tools.splice(tools.indexOf(tool), 1),
            { once: true }
          );
        },
      },
    });
  });
  await page.getByRole("button", { name: "Retry publication" }).click();

  await expect(status(page)).toHaveText("Publication: active");
  await waitForPublishedTool(page, "CounterPage.increment");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("1");
});
