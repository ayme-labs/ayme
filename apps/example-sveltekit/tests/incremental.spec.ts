import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import {
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/ayme/testing";

const counterModePath = fileURLToPath(
  new URL("../src/lib/pom/CounterMode.ts", import.meta.url)
);

test("rebuilds POM metadata from an imported type without restarting vite dev", async ({
  context,
  page,
}) => {
  const original = await readFile(counterModePath, "utf8");
  const changed = original.replace('"double"', '"triple"');
  expect(changed).not.toBe(original);
  await recordPublishedTools(context);
  // The published schema of `setMode` carries the compiled `CounterMode`
  // values. Vite's dev server can reload the page at any moment, so the
  // schema is read inside one wait, which Playwright re-runs in each new
  // document until one has published it.
  const publishedModeSchema = () =>
    page
      .waitForFunction(
        () => {
          const tool = (
            document.modelContext as unknown as RecordingDriver
          ).tools.find((candidate) => candidate.name === "CounterPage.setMode");
          return tool ? JSON.stringify(tool.inputSchema) : "";
        },
        undefined,
        { timeout: 30_000 }
      )
      .then((schema) => schema.jsonValue());

  await page.goto("/");
  expect(await publishedModeSchema()).toContain('"double"');

  try {
    await writeFile(counterModePath, changed);
    // Vite hot-updates the edited module without reloading the page, so the
    // page is reloaded until it publishes the rebuilt schema. The load event
    // fires before the app's modules run, so each document is given until it
    // publishes; reloading on a timer instead can cut every document short on
    // a slow runner. When one of Vite's own reloads aborts ours, it reloads
    // the page all the same.
    while (!(await publishedModeSchema()).includes('"triple"'))
      await page.reload().catch(() => {});
  } finally {
    await writeFile(counterModePath, original);
  }
});
