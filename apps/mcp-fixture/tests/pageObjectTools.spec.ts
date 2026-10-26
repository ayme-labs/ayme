import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/** The Page Object Tool of the fixture's Basket Page Object. */
const BASKET_TOOL = "Basket.readHeading";
/** Every tool of the Basket, as the note lists them; `clear` needs items. */
const BASKET_TOOLS = `${BASKET_TOOL}, Basket.clear`;

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
  // Connecting waits until the MCP tool list has the page's tools, so the
  // agent has seen them.
  await connect();
  expect((await agent.call("ayme_list_tools")).note).toBeUndefined();

  // From here the agent waits for the server's list change and doesn't re-list.
  const listChanged = async (change: () => Promise<void>) => {
    const changes = agent.toolListChanges();
    await change();
    await expect.poll(() => agent.toolListChanges()).toBeGreaterThan(changes);
  };
  await listChanged(() => showBasket(page));
  const listed = await agent.call("ayme_list_tools");
  // The tool's own result stays as it is; the note follows it.
  expect(
    (JSON.parse(listed.text) as { name: string }[]).map((tool) => tool.name)
  ).toContain(BASKET_TOOL);
  expect(listed.note).toContain(
    `Appeared: ${BASKET_TOOLS} (unavailable: The basket is empty).`
  );
  expect(listed.note).not.toContain("Disappeared");
  expect((await agent.call(BASKET_TOOL)).note).toBeUndefined();

  await listChanged(() => hideBasket(page));
  const called = await agent.call("ayme_call", { tool: "snapshot" });
  expect(called.isError, called.text).toBe(false);
  expect(JSON.parse(called.text).structure).toContain('heading "Groceries"');
  expect(called.note).toContain(`Disappeared: ${BASKET_TOOLS}.`);
  expect(called.note).not.toContain("Appeared");

  await listChanged(() => showBasket(page));
  const connected = await agent.call("ayme_connect", { url: page.url() });
  expect(connected.note).toContain(`Appeared: ${BASKET_TOOLS}`);
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

  // It says the tool is gone, not that the agent named a tool that never was.
  const direct = await agent.call(BASKET_TOOL);
  expect(direct.isError).toBe(true);
  expect(direct.text).toContain(`The tool "${BASKET_TOOL}" is gone`);
  const fallback = await agent.call("ayme_call", { tool: BASKET_TOOL });
  expect(fallback.isError).toBe(true);
  expect(fallback.text).toContain(`The tool "${BASKET_TOOL}" is gone`);
  expect(fallback.text).not.toContain("ayme_list_tools");
});

test("a class tool appears with its first instance and disappears with its last", async ({
  agent,
  connect,
  page,
}) => {
  await connect("/?class-tools");
  await showBasket(page);
  await expect.poll(() => agent.pageToolNames()).toContain(BASKET_TOOL);
  await agent.call("ayme_list_tools");
  const fill = () => page.getByRole("button", { name: "Fill basket" }).click();
  const before = agent.toolListChanges();
  await fill();
  await expect.poll(() => agent.toolListChanges()).toBeGreaterThan(before);
  expect((await agent.call("ayme_list_tools")).note).toContain(
    "Appeared: BasketItem.remove"
  );
  await fill();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  expect((await agent.call("snapshot")).note).toBeUndefined();
  const removeFirst = async () => {
    const snapshot = await agent.call("snapshot");
    const ref = JSON.parse(snapshot.text).structure.match(
      /((?:e|s_)\w+) BasketItem\b/
    )?.[1];
    expect(ref, snapshot.text).toBeDefined();
    return agent.call("BasketItem.remove", { ref });
  };
  expect((await removeFirst()).note).toBeUndefined();
  expect((await removeFirst()).note).toContain(
    "Disappeared: BasketItem.remove"
  );
});
