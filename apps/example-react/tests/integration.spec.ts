import { expect, test } from "@playwright/test";
import { CounterPage } from "../playwright/pom/CounterPage";

test("uses the same POM with real Playwright", async ({ page }) => {
  await page.goto("/");
  await new CounterPage(page).increment();
  await expect(page.locator("output")).toHaveText("1");
});

test("keeps one Inspector and one trace through StrictMode remounts", async ({
  page,
}) => {
  await page.goto("/");
  const inspectorHost = page.locator("[data-ayme-inspector-host]");
  await expect(inspectorHost).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "POM inspector" })
  ).toBeVisible();
  await expect(page.locator('[data-pom-class="CounterPage"]')).toHaveCount(1);
  const incrementMember = page.locator(
    '[data-pom-class="CounterPage"] [data-member-name="incrementButton"]'
  );
  await expect(incrementMember).toBeVisible();
  await incrementMember.hover();
  const incrementButton = page.getByRole("button", {
    name: "Increment",
    exact: true,
  });
  await expect(incrementButton).toHaveAttribute("data-ayme-highlight", "");
  await expect(incrementButton).toHaveCSS("outline-style", "solid");
  await expect(incrementButton).toHaveCSS("outline-width", "3px");

  await page.getByRole("button", { name: "Call Page Object" }).click();
  const latestTrace = page.getByLabel("Latest browser trace");
  await expect(latestTrace).toContainText("click");
  expect(
    (await latestTrace.textContent())?.match(/"operation": "click"/g)
  ).toHaveLength(1);
  // The trace appears when the click starts. Wait for it to finish: an
  // in-flight browser click intercepts pointer events aimed elsewhere.
  await expect(
    page.getByRole("region", { name: "Counter" }).getByRole("status")
  ).toHaveText("1");

  await page.getByRole("button", { name: "Unmount counter" }).click();
  await expect(page.locator('[data-pom-class="CounterPage"]')).toHaveCount(0);
  await expect(inspectorHost).toHaveCount(1);
  await page.getByRole("button", { name: "Mount counter" }).click();
  await expect(page.locator('[data-pom-class="CounterPage"]')).toHaveCount(1);
  await expect(inspectorHost).toHaveCount(1);
});

test("collapses to a draggable Ayme logo FAB", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Collapse inspector" }).click();

  const fab = page.getByRole("button", {
    name: "Open Ayme POM inspector",
  });
  await expect(fab).toBeVisible();
  await expect(fab.locator("svg")).toHaveAttribute("viewBox", "0 0 165.84 136");
  await expect(fab.locator("svg path")).toHaveAttribute("fill", "#6936F1");
  await expect(fab.locator("svg path")).toHaveAttribute(
    "d",
    /M120\.57 131\.59/
  );

  const before = await fab.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;

  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 - 80,
    before.y + before.height / 2 - 40,
    { steps: 6 }
  );
  await page.mouse.up();

  const after = await fab.boundingBox();
  expect(after).not.toBeNull();
  if (!after) return;
  expect(after.x).toBeLessThan(before.x - 20);
  expect(after.y).toBeLessThan(before.y - 10);

  await fab.click();
  await expect(
    page.getByRole("heading", { name: "POM inspector" })
  ).toBeVisible();
});

test("publishes, executes, and removes compiled tools under StrictMode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      { execute: (args: Record<string, unknown>) => Promise<unknown> }
    >();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(
          tool: {
            name: string;
            execute: (args: Record<string, unknown>) => Promise<unknown>;
          },
          { signal }: { signal: AbortSignal }
        ) {
          if (signal.aborted) return;
          if (tools.has(tool.name))
            throw new Error(`Duplicate tool: ${tool.name}`);
          tools.set(tool.name, tool);
          signal.addEventListener("abort", () => tools.delete(tool.name), {
            once: true,
          });
        },
        tools,
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active"
  );
  const names = () =>
    page.evaluate(() => [
      ...(
        document.modelContext as unknown as { tools: Map<string, unknown> }
      ).tools.keys(),
    ]);
  await expect
    .poll(names)
    .toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "CounterPage.increment",
    ]);
  await page.evaluate(async () => {
    const driver = document.modelContext as unknown as {
      tools: Map<
        string,
        { execute: (args: Record<string, unknown>) => Promise<unknown> }
      >;
    };
    await driver.tools.get("CounterPage.increment")!.execute({});
  });
  await expect(page.locator("output")).toHaveText("1");
  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("2");
  await page.getByRole("button", { name: "Unmount counter" }).click();
  await expect
    .poll(names)
    .toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
    ]);
  await page
    .getByRole("button", { name: "Mount counter", exact: true })
    .click();
  await expect
    .poll(names)
    .toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "CounterPage.increment",
    ]);
  await expect(page.locator("output")).toHaveText("0");
});
