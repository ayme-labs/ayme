import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/** The Page Object Tool of the fixture's Basket Page Object. */
const BASKET_TOOL = "Basket.readHeading";

const showBasket = (page: Page) =>
  page.getByRole("button", { name: "Show basket" }).click();
const hideBasket = (page: Page) =>
  page.getByRole("button", { name: "Hide basket" }).click();

test("a Page Object's tools become MCP tools when it appears and go when it leaves", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  expect(await agent.pageToolNames()).not.toContain(BASKET_TOOL);

  const beforeShowing = agent.toolListChanges();
  await showBasket(page);
  await expect.poll(() => agent.pageToolNames()).toContain(BASKET_TOOL);
  expect(agent.toolListChanges()).toBeGreaterThan(beforeShowing);

  const beforeHiding = agent.toolListChanges();
  await hideBasket(page);
  await expect.poll(() => agent.pageToolNames()).not.toContain(BASKET_TOOL);
  expect(agent.toolListChanges()).toBeGreaterThan(beforeHiding);
});

test("ayme_list_tools and ayme_call reach a Page Object Tool as soon as the page has it", async ({
  agent,
  connect,
  page,
}) => {
  await connect();

  await showBasket(page);
  await expect
    .poll(async () => (await agent.call("ayme_list_tools")).text)
    .toContain(BASKET_TOOL);

  const { text, isError } = await agent.call("ayme_call", {
    tool: BASKET_TOOL,
  });
  expect(isError, text).toBe(false);
  expect(text).toContain("Groceries");
});

test("every result notes the tools that appeared or disappeared since the previous call", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  const afterPairing = await agent.call("ayme_list_tools");
  expect(afterPairing.note).toContain("Appeared:");
  expect(afterPairing.note).toContain("snapshot");
  expect((await agent.call("ayme_list_tools")).note).toBeUndefined();

  await showBasket(page);
  await expect.poll(() => agent.pageToolNames()).toContain(BASKET_TOOL);
  const listed = await agent.call("ayme_list_tools");
  // The tool's own result stays as it is; the note follows it.
  expect(
    (JSON.parse(listed.text) as { name: string }[]).map((tool) => tool.name)
  ).toContain(BASKET_TOOL);
  expect(listed.note).toContain(`Appeared: ${BASKET_TOOL}.`);
  expect(listed.note).not.toContain("Disappeared");
  expect((await agent.call(BASKET_TOOL)).note).toBeUndefined();

  await hideBasket(page);
  await expect.poll(() => agent.pageToolNames()).not.toContain(BASKET_TOOL);
  const called = await agent.call("ayme_call", { tool: "snapshot" });
  expect(called.isError, called.text).toBe(false);
  expect(JSON.parse(called.text).structure).toContain('heading "Groceries"');
  expect(called.note).toContain(`Disappeared: ${BASKET_TOOL}.`);
  expect(called.note).not.toContain("Appeared");

  await showBasket(page);
  await expect.poll(() => agent.pageToolNames()).toContain(BASKET_TOOL);
  const connected = await agent.call("ayme_connect", { url: page.url() });
  expect(connected.note).toContain(`Appeared: ${BASKET_TOOL}.`);
});

test("a Page Object Tool that went is no longer callable", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  await showBasket(page);
  await expect.poll(() => agent.pageToolNames()).toContain(BASKET_TOOL);

  await hideBasket(page);
  await expect.poll(() => agent.pageToolNames()).not.toContain(BASKET_TOOL);

  const direct = await agent.call(BASKET_TOOL);
  expect(direct.isError).toBe(true);
  expect(direct.text).toContain(BASKET_TOOL);
  const fallback = await agent.call("ayme_call", { tool: BASKET_TOOL });
  expect(fallback.isError).toBe(true);
  expect(fallback.text).toContain("ayme_list_tools");
});
