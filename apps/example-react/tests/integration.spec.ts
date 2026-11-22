import { expect } from "@playwright/test";
import {
  counterTests,
  devRebuildTests,
  test,
} from "@ayme-dev/example-certification/tests";
import {
  publishedToolNames,
  recordPublishedTools,
} from "@ayme-dev/webmcp/testing";
import { CounterPage } from "../playwright/pom/CounterPage";

// The shared certification, against the dev server and the production build.
// The app is a single-page app with no router, so it has no client navigation
// to check and no server-rendered page.
counterTests({ CounterPage, inspector: true });

// React's own check: StrictMode mounts, unmounts and mounts every effect in
// development, and each tool must still be published once.
test("publishes each tool once under StrictMode", async ({ context, page }) => {
  await recordPublishedTools(context);
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active"
  );
  await expect
    .poll(async () =>
      (await publishedToolNames(page)).filter((name) =>
        /^(Sub)?CounterPage\./.test(name)
      )
    )
    .toHaveLength(4);
  const names = await publishedToolNames(page);
  expect(new Set(names).size).toBe(names.length);
});

// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: new URL("../playwright/pom/CounterMode.ts", import.meta.url),
});
