import { expect, test } from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} from "@ayme-dev/ayme/testing";
import { CounterPage } from "../src/lib/pom/CounterPage";

// Run the same contract against vite dev and the built adapter-node server,
// with server rendering and in SPA mode.
const ssr = process.env.VITE_AYME_SSR !== "off";

test.describe("server render", () => {
  test.use({ javaScriptEnabled: false });

  test("renders nothing on the server in SPA mode", async ({ page }) => {
    test.skip(ssr, "Server rendering is on.");
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(0);
  });

  test("returns the page and the initial status on repeated requests", async ({
    page,
  }) => {
    test.skip(!ssr, "SPA mode renders no server HTML.");
    for (let request = 0; request < 2; request += 1) {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
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

test("hydrates, publishes, executes, and cleans up on remount and navigation", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text()))
      errors.push(message.text());
  });
  await recordPublishedTools(context);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
  );
  await expect(page.getByTestId("started")).toHaveText(
    "Runtime at child mount: started"
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
  // A remount constructs a new instance for the new DOM.
  await expect(page.locator("output")).toHaveText("0");
  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");

  // Client navigation: the layout keeps the owner, the page's POM goes.
  await page.getByRole("link", { name: "Other" }).click();
  await expect(
    page.getByText("Other page without Page Objects.")
  ).toBeVisible();
  await expect
    .poll(() => publishedToolNames(page))
    .not.toContain("CounterPage.increment");
  await page.getByRole("link", { name: "Home" }).click();
  await expect
    .poll(() => publishedToolNames(page))
    .toContain("CounterPage.increment");
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active"
  );
  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");

  expect(errors).toEqual([]);
});
