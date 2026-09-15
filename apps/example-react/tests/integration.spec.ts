import { expect, test } from "@playwright/test";
import type { WebMcpDriver } from "@ayme-dev/webmcp/internal";
import { CounterPage } from "../playwright/pom/CounterPage";

test("uses the same POM with real Playwright", async ({ page }) => {
  await page.goto("/");
  await new CounterPage(page).increment();
  await expect(page.locator("output")).toHaveText("1");
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
    const driver = document.modelContext as unknown as WebMcpDriver & {
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
