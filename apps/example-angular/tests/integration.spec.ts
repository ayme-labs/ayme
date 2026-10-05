import { expect } from "@playwright/test";
import { CounterPage } from "../playwright/pom/CounterPage";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} from "@ayme-dev/ayme/testing";
import {
  exampleTest as test,
  isRefusedAutoPairProbe,
} from "@ayme-dev/example-certification/tests";

// Run the same contract against ng serve and the production build, for the
// default SSR build and the spa build configuration.
const run = () =>
  test.info().config.metadata as {
    render: "ssr" | "spa";
    server: "development" | "production";
  };

test.describe("server render", () => {
  test.use({ javaScriptEnabled: false });
  test.skip(() => run().render === "spa", "SSR only");

  test("returns the rendered UI with inert Page Objects on repeated requests", async ({
    page,
  }) => {
    for (let request = 0; request < 2; request += 1) {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Ayme Angular example" })
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

  test("renders the status of the options the browser will use", async ({
    page,
  }) => {
    await page.goto("/?publication=off");
    await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
      "Publication: disabled"
    );
  });
});

test("publishes the compiled POM, executes it, and cleans up on remount and navigation", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  const hydration: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (isRefusedAutoPairProbe(text)) return;
    if (/Angular hydrated/.test(text)) hydration.push(text);
    else if (message.type() === "error" || /NG0\d{3}|mismatch/i.test(text))
      errors.push(text);
  });
  await recordPublishedTools(context);

  // In development the Inspector loads after the page. Its mount can hold the
  // main thread past a Page Object action's 1 s timeout, so let it land first.
  const response = await page.goto("/", { waitUntil: "networkidle" });
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
  const setMode = {
    description: "Set counter mode metadata.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["single", "double"] } },
      required: ["mode"],
      additionalProperties: false,
    },
  };
  expect(await publishedToolSchema(page, "CounterPage.setMode")).toEqual({
    name: "CounterPage.setMode",
    ...setMode,
  });
  // SubCounterPage's file has no decorator; the plugin must still claim it
  // and publish its inherited tools.
  expect(await publishedToolSchema(page, "SubCounterPage.setMode")).toEqual({
    name: "SubCounterPage.setMode",
    ...setMode,
  });
  expect(await publishedToolNames(page)).toContain("SubCounterPage.increment");
  await expect(page.locator("output")).toHaveText("0");

  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("2");
  await new CounterPage(page).increment();
  await expect(page.locator("output")).toHaveText("3");

  // @if removal destroys the component and its registration.
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

  // Router navigation does the same.
  await page.getByRole("link", { name: "Other page" }).click();
  await expect(page.getByRole("heading", { name: "Other page" })).toBeVisible();
  await expect
    .poll(() => publishedToolNames(page))
    .not.toContain("CounterPage.increment");
  // OtherPage is imported through the tsconfig `paths` alias @pom/*.
  await expect
    .poll(() => publishedToolSchema(page, "OtherPage.goHome"))
    .toEqual({
      name: "OtherPage.goHome",
      description: "Go back to the counter page.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    });
  await executePublishedTool(page, "OtherPage.goHome");
  await expect
    .poll(() => publishedToolNames(page))
    .toContain("CounterPage.increment");
  await expect(page.locator("output")).toHaveText("0");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("1");
  expect(errors).toEqual([]);
  // Development builds report hydration; production builds are silent.
  if (run().render === "ssr" && run().server === "development")
    expect(hydration).toEqual([
      expect.stringMatching(
        /hydrated 3 component\(s\).* 0 component\(s\) were skipped/
      ),
    ]);
});
