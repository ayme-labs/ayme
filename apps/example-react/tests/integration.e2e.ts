import { expect } from "e2e";
import {
  counterTests,
  devRebuildTests,
  publishedToolNames,
  recordPublishedTools,
  test,
} from "@ayme-dev/example-certification/e2e/tests";

// The shared certification, against the dev server and the production build.
// The app is a single-page app with no router, so it has no client navigation
// to check and no server-rendered page.
counterTests({ inspector: true });

// React's own check: StrictMode mounts, unmounts and mounts every effect in
// development, and each tool must still be published once.
test("publishes each tool once under StrictMode", async ({
  app,
  browser,
  screen,
}) => {
  await recordPublishedTools(browser);
  await app.open("/");
  await expect(screen.getByRole("status", "Publication")).toHaveText(
    "Publication: active"
  );
  await expect
    .poll(async () =>
      (await publishedToolNames(browser)).filter((name) =>
        /^(Sub)?CounterPage\./.test(name)
      )
    )
    .toHaveLength(4);
  const names = await publishedToolNames(browser);
  expect(new Set(names).size).toBe(names.length);
});

// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: new URL("../playwright/pom/CounterMode.ts", import.meta.url),
});
