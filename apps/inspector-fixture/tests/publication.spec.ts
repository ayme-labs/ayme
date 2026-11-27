import type { RecordingDriver } from "@ayme-dev/webmcp/testing";

import { AppView } from "./appView";
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

test.describe("on a page whose session has the Inspector on", () => {
  test.use({ fixturePath: "/session.html" });

  test("a Peek runs in the panel and is never published", async ({
    page,
    agent,
    inspector,
  }) => {
    await page.evaluate(() => {
      window.fixtureAyme!.peek(
        () => ({ items: document.querySelectorAll("li").length }),
        "list"
      );
    });

    await (await inspector.tool("peek.list")).run();
    const run = inspector.runs.latest("peek.list");
    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(JSON.parse((await run.resultText())!)).toEqual({
      name: "list",
      instances: [{ values: { items: 0 } }],
    });

    // The runtime lists the Peek beside the tools the page publishes.
    const listed = await new AppView(page).tools();
    expect(listed.map(({ name }) => name)).toContain("peek.list");
    await expect
      .poll(async () => (await agent!.toolNames()).sort())
      .toEqual(
        listed
          .map(({ name }) => name)
          .filter((name) => name !== "peek.list")
          .sort()
      );
  });
});
