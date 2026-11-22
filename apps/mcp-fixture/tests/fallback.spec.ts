import { SERVER_TOOLS, expect, test } from "./fixtures";

test("ayme_list_tools lists the page's tools as the MCP tool list does, and whether each can run", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("ayme_list_tools");

  expect(isError, text).toBe(false);
  const { tools } = await agent.client.listTools();
  const pageTools = tools
    .filter((tool) => !SERVER_TOOLS.includes(tool.name))
    .map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  const listed = JSON.parse(text) as ((typeof pageTools)[number] & {
    available: boolean;
  })[];
  expect(
    listed.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
  ).toEqual(pageTools);
  // Nothing on the fixture page is unavailable before a Page Object shows.
  expect(listed.every((tool) => tool.available)).toBe(true);
  expect(pageTools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["page_objects", "GroceriesPage.readHeading"])
  );
});

test("ayme_call runs a tool the agent's client never listed", async ({
  agent,
  page,
  baseURL,
}) => {
  const listed = await agent.toolNames();
  expect(listed).not.toContain("GroceriesPage.readHeading");
  const { text: link } = await agent.call("ayme_connect", {
    url: new URL("/", baseURL).href,
  });
  await page.goto(link);
  await expect
    .poll(async () => (await agent.call("ayme_list_tools")).isError, {
      message: `The page never connected. Server log:\n${agent.log}`,
    })
    .toBe(false);

  const { text, isError } = await agent.call("ayme_call", {
    tool: "GroceriesPage.readHeading",
  });

  expect(isError, text).toBe(false);
  expect(JSON.parse(text)).toMatchObject({ result: "Groceries" });
});

test("ayme_call returns the result a direct call returns", async ({
  agent,
  connect,
}) => {
  await connect();

  for (const tool of ["GroceriesPage.readHeading", "GroceriesPage.fail"]) {
    const direct = await agent.call(tool);
    const fallback = await agent.call("ayme_call", { tool });
    expect(fallback).toEqual(direct);
  }
});

test("ayme_call with an unknown tool names it", async ({ agent, connect }) => {
  await connect();

  const { text, isError } = await agent.call("ayme_call", {
    tool: "no_such_tool",
  });

  expect(isError).toBe(true);
  expect(text).toContain(
    'No connected page or App Process offers a tool "no_such_tool".'
  );
});

test("ayme_call without a tool name says the tool is required", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("ayme_call", {});

  expect(isError).toBe(true);
  expect(text).toContain("ToolInputError: Input property tool is required.");
});

test("with no page connected, page tools and fallback tools say no page is connected", async ({
  agent,
}) => {
  for (const [name, input] of [
    ["ayme_list_tools", {}],
    ["ayme_call", { tool: "page_objects" }],
    ["page_objects", {}],
  ] as const) {
    const { text, isError } = await agent.call(name, input);
    expect(isError, name).toBe(true);
    expect(text, name).toContain("No page is connected.");
  }
});

test("a page tool the agent listed before the tab closed says the tab did not come back", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  expect(await agent.pageToolNames()).toContain("page_objects");

  await page.close();
  await expect.poll(() => agent.pageToolNames()).toEqual([]);

  // The server holds the call while it waits for the tab to reconnect.
  const { text, isError } = await agent.call("page_objects");
  expect(isError).toBe(true);
  expect(text).toBe(
    "The page's connection closed and its tab did not reconnect, so the call did not run."
  );
});

test("page tools and ayme_list_tools called right after ayme_connect wait for the page its link opens", async ({
  agent,
  page,
  baseURL,
}) => {
  const { text } = await agent.call("ayme_connect", { url: `${baseURL}/` });
  const pageObjects = agent.call("page_objects");
  const listing = agent.call("ayme_list_tools");

  await page.goto(text.split("\n")[0]!);

  const read = await pageObjects;
  expect(read.isError, read.text).toBe(false);
  const listed = await listing;
  expect(listed.isError, listed.text).toBe(false);
  expect(
    (JSON.parse(listed.text) as { name: string }[]).map(({ name }) => name)
  ).toContain("page_objects");
});
