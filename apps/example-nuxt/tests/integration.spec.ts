import { expect } from "@playwright/test";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";
import { CounterPage } from "../playwright/pom/CounterPage";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} from "@ayme-dev/ayme/testing";

// Run the same contract against nuxt dev and the built Nitro server.
test.describe("server render", () => {
  test.use({ javaScriptEnabled: false });

  test("returns the Ayme subtree without browser registration on repeated requests", async ({
    page,
  }) => {
    for (let request = 0; request < 2; request += 1) {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Ayme Nuxt prototype" })
      ).toBeVisible();
      await expect(page.getByRole("region", { name: "Counter" })).toBeVisible();
      await expect(page.locator("output")).toHaveText("0");
      await expect(
        page.getByRole("status", { name: "Publication" })
      ).toHaveText("Publication: waiting");
      await expect(
        page.getByRole("button", { name: "Call Page Object" })
      ).toBeVisible();
    }
  });
});

test("hydrates, publishes the compiled POM, executes it, and cleans up on remount", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/hydration.*mismatch/i.test(message.text()))
      errors.push(message.text());
  });
  await recordPublishedTools(context);

  // In development the Inspector loads after the page. Its mount can hold the
  // main thread past a Page Object action's 1 s timeout, so let it land first.
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  // nuxt dev compiles the Page Object Model on first request, one TypeScript
  // Program, which takes over 10 s on CI while other example apps build.
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 30_000 }
  );
  // The published schema matches the metadata declared in the POM source.
  await expect
    .poll(() => publishedToolSchema(page, "CounterPage.increment"))
    .toEqual({
      name: "CounterPage.increment",
      description: "Increment the counter.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    });
  await expect(page.locator("output")).toHaveText("0");
  // Ayme's own tools, by name: every published name without a Page Object's dot.
  expect(
    (await publishedToolNames(page)).filter((name) => !name.includes("."))
  ).toEqual([
    "snapshot",
    "click",
    "hover",
    "type",
    "fill",
    "check",
    "uncheck",
    "select_option",
    "fill_form",
    "press_key",
    "generate_locator",
  ]);

  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("2");
  await new CounterPage(page).increment();
  await expect(page.locator("output")).toHaveText("3");

  await page.getByRole("button", { name: "Unmount counter" }).click();
  await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(0);
  await expect
    .poll(() => publishedToolNames(page))
    .not.toContain("CounterPage.increment");
  await page
    .getByRole("button", { name: "Mount counter", exact: true })
    .click();
  await expect
    .poll(() => publishedToolNames(page))
    .toContain("CounterPage.increment");
  await expect(page.locator("output")).toHaveText("0");
  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");
  expect(errors).toEqual([]);
});
