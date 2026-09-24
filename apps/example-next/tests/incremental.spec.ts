import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import {
  publishedToolSchema,
  recordPublishedTools,
  waitForPublishedTool,
} from "./publishedTools";

const counterModePath = fileURLToPath(
  new URL("../playwright/pom/CounterMode.ts", import.meta.url)
);

test("rebuilds POM metadata from an imported type without restarting Next", async ({
  context,
  page,
}) => {
  const original = await readFile(counterModePath, "utf8");
  const changed = original.replace('"double"', '"triple"');
  expect(changed).not.toBe(original);
  await recordPublishedTools(context);
  // The published schema of `setMode` carries the compiled `CounterMode` values.
  const modeSchema = async () =>
    JSON.stringify(
      (await publishedToolSchema(page, "CounterPage.setMode"))?.inputSchema ??
        null
    );

  await page.goto("/");
  await waitForPublishedTool(page, "CounterPage.setMode");
  expect(await modeSchema()).toContain('"double"');

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
});
