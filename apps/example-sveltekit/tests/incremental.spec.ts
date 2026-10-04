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

const settle = (ms: number) =>
  new Promise<true>((resolve) => setTimeout(() => resolve(true), ms));

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
  // schema is checked inside one wait, which Playwright re-runs in each new
  // document, rather than read after it.
  const waitForModeSchemaWith = (value: string) =>
    page.waitForFunction(
      (value) => {
        const tool = (
          document.modelContext as unknown as RecordingDriver
        ).tools.find((candidate) => candidate.name === "CounterPage.setMode");
        return JSON.stringify(tool?.inputSchema ?? null).includes(value);
      },
      value,
      { timeout: 30_000 }
    );

  await page.goto("/");
  await waitForModeSchemaWith('"double"');

  try {
    await writeFile(counterModePath, changed);
    // Vite hot-updates the edited module without reloading the page, so the
    // page is reloaded until it publishes the rebuilt schema. When one of
    // Vite's own reloads aborts ours, it reloads the page all the same.
    const rebuilt = waitForModeSchemaWith('"triple"');
    while (await Promise.race([rebuilt.then(() => false), settle(500)]))
      await page.reload().catch(() => {});
  } finally {
    await writeFile(counterModePath, original);
  }
});
