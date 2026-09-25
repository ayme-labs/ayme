import { expect, test } from "@playwright/test";
import { CounterPage } from "../playwright/pom/CounterPage";

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
      "Publication: disabled"
    );
    await expect(
      page.getByRole("button", { name: "Call Page Object" })
    ).toBeVisible();
  });
});

test("hydrates, uses the compiled POM and real Playwright, then remounts", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: disabled"
  );
  await expect(page.locator("output")).toHaveText("0");
  // SubCounterPage's file has no decorator; the Turbopack rule and the
  // compiler must still reach it and register its inherited tools.
  await expect(page.getByTestId("compiled-metadata")).toContainText(
    '"toolName":"SubCounterPage.increment"'
  );
  // usePageObject rejects models without compiler-derived metadata. This call
  // therefore checks the actual loader, registration and browser action path.
  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");

  await new CounterPage(page).increment();
  await expect(page.locator("output")).toHaveText("2");

  await page.getByRole("button", { name: "Unmount counter" }).click();
  await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mount counter", exact: true })
    .click();
  await expect(page.locator("output")).toHaveText("0");
  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");
  expect(pageErrors).toEqual([]);
});
