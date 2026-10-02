import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import {
  publishedToolSchema,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

const counterModePath = fileURLToPath(
  new URL("../playwright/pom/CounterMode.ts", import.meta.url)
);

// The published schema of `setMode` carries the compiled `CounterMode` values.
async function modeSchemaAfterReload(page: Page) {
  await page.reload();
  await waitForPublishedTool(page, "CounterPage.setMode");
  return JSON.stringify(
    (await publishedToolSchema(page, "CounterPage.setMode"))?.inputSchema
  );
}

test("rebuilds POM metadata from an imported type without restarting ng serve", async ({
  context,
  page,
}) => {
  test.skip(
    test.info().config.metadata.server !== "development",
    "development only"
  );
  const original = await readFile(counterModePath, "utf8");
  const changed = original.replace('"double"', '"triple"');
  expect(changed).not.toBe(original);
  await recordPublishedTools(context);

  await page.goto("/");
  await waitForPublishedTool(page, "CounterPage.setMode");
  expect(await modeSchemaAfterReload(page)).toContain('"double"');

  const rebuild = { timeout: 30_000, intervals: [250, 500, 1_000] };
  try {
    await writeFile(counterModePath, changed);
    await expect
      .poll(() => modeSchemaAfterReload(page), rebuild)
      .toContain('"triple"');
  } finally {
    await writeFile(counterModePath, original);
  }
  // Let the restore's rebuild finish before the next run starts the server.
  await expect
    .poll(() => modeSchemaAfterReload(page), rebuild)
    .toContain('"double"');
});
