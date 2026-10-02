import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  publishedToolSchema,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

const counterModePath = path.resolve("playwright/pom/CounterMode.ts");

test("rebuilds POM metadata from an imported type without restarting ng serve", async ({
  context,
  page,
}) => {
  test.skip(process.env["PROBE_MODE"] !== "dev", "development only");
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (/hydrated/i.test(message.text())) hydration.push(message.text());
  });
  const original = await readFile(counterModePath, "utf8");
  const changed = original.replace('"double"', '"triple"');
  expect(changed).not.toBe(original);
  await recordPublishedTools(context);
  const modeSchema = async () =>
    JSON.stringify(
      (await publishedToolSchema(page, "CounterPage.setMode"))?.inputSchema ??
        null
    );

  await page.goto("/");
  await waitForPublishedTool(page, "CounterPage.setMode");
  expect(await modeSchema()).toContain('"double"');
  expect(hydration.join("\n")).toMatch(/Angular hydrated \d+ component/);
  try {
    await writeFile(counterModePath, changed);
    await expect
      .poll(
        async () => {
          await page.reload();
          await waitForPublishedTool(page, "CounterPage.setMode");
          return modeSchema();
        },
        { timeout: 30_000, intervals: [250, 500, 1_000] }
      )
      .toContain('"triple"');
  } finally {
    await writeFile(counterModePath, original);
  }
  // Let the restore's rebuild and live reload finish before the next test.
  await expect
    .poll(
      async () => {
        await page.reload();
        await waitForPublishedTool(page, "CounterPage.setMode");
        return modeSchema();
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] }
    )
    .toContain('"double"');
  await page.waitForTimeout(2_000);
});
