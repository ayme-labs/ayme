import { expect, selectors } from "@playwright/test";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";
import { server } from "@ayme-dev/example-certification/config";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

// The Inspector renders into a closed shadow root; its page objects reach it
// through these selectors.
test.beforeAll(() => registerInspectorSelectors(selectors));

test("opens the Inspector and runs a tool from it", async ({ page }) => {
  test.skip(server !== "dev", "The app turns the Inspector on in development");
  await page.goto("/");
  const inspector = new Inspector(page);

  await inspector.open();
  await (await inspector.tool("CounterPage.increment")).run();

  await expect(page.locator("output")).toHaveText("1");
});

test("loads no Inspector code with the inspector option off", async ({
  page,
}) => {
  test.skip(server !== "production", "The production build turns it off");
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(response.text());
  });

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator("output")).toHaveText("0");
  // A string only the Inspector's code contains.
  const inspectorCode = (await Promise.all(scripts)).filter((script) =>
    script.includes("ayme-inspector:preferences")
  );
  expect(inspectorCode).toEqual([]);
  await expect(page.locator("ayme-inspector")).toHaveCount(0);
});
