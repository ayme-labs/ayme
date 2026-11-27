import type { RecordingDriver } from "@ayme-dev/webmcp/testing";

import { callAsAgent, expect, test } from "./fixtures";

// E2E: what the page publishes over WebMCP, read through the recording
// driver as an agent in the browser reads it.

test.use({ connected: true });

const CLEAR = "ListPage.clear";

test("an unavailable Page Object Tool stays published, refuses its call with its reason, and runs once available, on the same published tool", async ({
  page,
  agent,
  listPage,
}) => {
  await expect.poll(() => agent!.toolNames()).toContain(CLEAR);
  // The tool object the driver was handed: a republication would replace it.
  const published = await page.evaluateHandle(
    (name) =>
      (document.modelContext as unknown as RecordingDriver).tools.find(
        (tool) => tool.name === name
      ),
    CLEAR
  );
  const stillPublished = () =>
    page.evaluate(
      (tool) =>
        (document.modelContext as unknown as RecordingDriver).tools.includes(
          tool!
        ),
      published
    );

  expect(await callAsAgent(agent!, CLEAR)).toEqual({
    isError: true,
    text: `RuntimeStateError: ${CLEAR} is unavailable: Nothing to clear.`,
  });

  await listPage.addItem("Milk");
  await expect(listPage.items).toHaveCount(1);
  expect(await stillPublished()).toBe(true);
  expect(await callAsAgent(agent!, CLEAR)).not.toHaveProperty("isError");
  await expect(listPage.items).toHaveCount(0);

  expect(await callAsAgent(agent!, CLEAR)).toEqual({
    isError: true,
    text: `RuntimeStateError: ${CLEAR} is unavailable: Nothing to clear.`,
  });
  expect(await stillPublished()).toBe(true);
});
