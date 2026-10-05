import { expect, selectors } from "@playwright/test";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

// The Inspector renders into a closed shadow root; its page objects reach it
// through these selectors.
test.beforeAll(() => registerInspectorSelectors(selectors));

test("opens the Inspector and runs a tool from it", async ({ page }) => {
  test.skip(
    test.info().config.metadata.server !== "development",
    "The app turns the Inspector on in dev mode only"
  );
  await page.goto("/");
  const inspector = new Inspector(page);

  await inspector.open();
  await (await inspector.tool("CounterPage.increment")).run();

  await expect(page.locator("output")).toHaveText("1");
});
