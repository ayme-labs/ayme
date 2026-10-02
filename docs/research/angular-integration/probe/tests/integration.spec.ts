import { expect, test } from "@playwright/test";
import { CounterPage } from "../playwright/pom/CounterPage";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} from "@ayme-dev/ayme/testing";

test.describe("server render", () => {
  test.use({ javaScriptEnabled: false });

  test("returns the Ayme subtree with inert Page Objects on repeated requests", async ({
    page,
  }) => {
    for (let request = 0; request < 2; request += 1) {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Ayme Angular probe" })
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

test("hydrates, publishes the compiled POM, executes it, and cleans up on remount and navigation", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /NG0\d{3}|mismatch/i.test(message.text()))
      errors.push(message.text());
    if (/Angular hydrated/.test(message.text())) hydration.push(message.text());
  });
  await recordPublishedTools(context);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
  );
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
  // Angular reports non-destructive hydration success in dev mode.
  expect(
    await page.evaluate(() =>
      document.querySelector("app-root")?.hasAttribute("ng-server-context")
    )
  ).toBe(true);

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

  // Route navigation destroys the component and its registration.
  await page.getByRole("link", { name: "Other page" }).click();
  await expect(page.getByRole("heading", { name: "Other" })).toBeVisible();
  await expect
    .poll(() => publishedToolNames(page))
    .not.toContain("CounterPage.increment");
  await page.getByRole("link", { name: "Home" }).click();
  await expect
    .poll(() => publishedToolNames(page))
    .toContain("CounterPage.increment");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("1");
  expect(errors).toEqual([]);
  // Development builds report hydration; production builds are silent.
  if (process.env["PROBE_MODE"] === "dev")
    expect(hydration[0]).toMatch(
      /hydrated 3 component\(s\).*0 component\(s\) were skipped/
    );
});
