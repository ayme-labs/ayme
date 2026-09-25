import { expect, test } from "@playwright/test";
import { CounterPage } from "../playwright/pom/CounterPage";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} from "./publishedTools";

// These tests run unchanged against next dev and the next build/next start app.
test.describe("server render", () => {
  test.use({ javaScriptEnabled: false });

  test("includes the Ayme subtree before hydration", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Ayme Next.js prototype" })
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Counter" })).toBeVisible();
    await expect(page.locator("output")).toHaveText("0");
    await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
      "Publication: waiting"
    );
    await expect(
      page.getByRole("button", { name: "Call Page Object" })
    ).toBeVisible();
  });
});

test("hydrates, publishes the compiled POM, uses it and real Playwright, then remounts", async ({
  context,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await recordPublishedTools(context);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
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
  const setMode = await publishedToolSchema(page, "CounterPage.setMode");
  expect(setMode?.description).toBe("Set counter mode metadata.");
  expect(JSON.stringify(setMode?.inputSchema)).toContain('"double"');
  await expect(page.locator("output")).toHaveText("0");
  // SubCounterPage's file has no decorator; the Turbopack rule and the
  // compiler must still reach it and publish its inherited tools.
  await expect
    .poll(() => publishedToolNames(page))
    .toContain("SubCounterPage.increment");
  // usePageObject rejects models without compiler-derived metadata. This call
  // therefore checks the actual loader, registration and browser action path.
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
  expect(pageErrors).toEqual([]);
});
