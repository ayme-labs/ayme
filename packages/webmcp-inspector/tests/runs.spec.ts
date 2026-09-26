import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// E2E: running tools from the panel, on the fixture page with the real
// ListPage Page Object, the Ayme runtime and Chromium's own WebMCP.

test("a run from the panel shows in Runs, marked as yours, with its steps", async ({
  inspector,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Succeeded");
  await expect(run.byYou).toBeVisible();
  // ListPage.addItem fills the new item's text, then presses Add item.
  expect(await run.stepList()).toEqual([
    { operation: "fill", target: "ListPage.newItemInput", value: '"Milk"' },
    { operation: "click", target: "ListPage.addItemButton" },
  ]);
});

test("hovering a run's step highlights its element on the page", async ({
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Succeeded");

  await run.stepTarget(1).hover();

  await expect(listPage.addItemButton).toHaveAttribute("data-ayme-highlight");
});

test("a tool that fails on the page shows its error", async ({
  page,
  inspector,
  listPage,
}) => {
  // The tool's target is gone: the page no longer has its Add item button.
  await listPage.addItemButton.evaluate((button) => button.remove());
  const agentError = await agentFailure(page, "ListPage.addItem", {
    text: "Milk",
  });

  const addItem = await inspector.tool("ListPage.addItem");
  await addItem.run({ text: "Milk" });

  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Failed");
  // The panel shows the error an agent gets for the same call. Its call log
  // varies with timing, so the first line is compared.
  expect(firstLine(await run.error.textContent())).toBe(firstLine(agentError));
});

/** The failure text an agent gets calling a tool over WebMCP. */
async function agentFailure(page: Page, name: string, input: object) {
  const result = await page.evaluate(
    async ({ name, input }) => {
      // Chromium's WebMCPTesting API.
      const context = document.modelContext as unknown as {
        getTools(): Promise<{ name: string }[]>;
        executeTool(tool: object, input: string): Promise<string | null>;
      };
      const tool = (await context.getTools()).find(
        (candidate) => candidate.name === name
      );
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      return await context.executeTool(tool, JSON.stringify(input));
    },
    { name, input }
  );
  const failure = JSON.parse(result ?? "null") as {
    isError?: boolean;
    content?: { text: string }[];
  };
  if (!failure.isError)
    throw new Error(`Expected ${name} to fail over WebMCP: ${result}`);
  return failure.content![0]!.text;
}

function firstLine(text: string | null) {
  return (text ?? "").split("\n")[0]!;
}
