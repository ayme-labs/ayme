import { SERVER_TOOLS, addItemRef, expect, test } from "./fixtures";

test("ayme_list_tools lists the page's tools as the MCP tool list does", async ({
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
  expect(JSON.parse(text)).toEqual(pageTools);
  expect(pageTools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["snapshot", "read_text"])
  );
});

test("ayme_call runs a tool the agent's client never listed", async ({
  agent,
  page,
  baseURL,
}) => {
  const listed = await agent.toolNames();
  expect(listed).not.toContain("snapshot");
  const { text: link } = await agent.call("ayme_connect", {
    url: new URL("/", baseURL).href,
  });
  await page.goto(link);
  await expect
    .poll(async () => (await agent.call("ayme_list_tools")).isError, {
      message: `The page never connected. Server log:\n${agent.log}`,
    })
    .toBe(false);

  const { text, isError } = await agent.call("ayme_call", { tool: "snapshot" });

  expect(isError, text).toBe(false);
  expect(JSON.parse(text).structure).toContain('heading "Groceries"');
});

test("ayme_call returns the result a direct call returns", async ({
  agent,
  connect,
}) => {
  await connect();
  const ref = await addItemRef(agent);

  for (const input of [{ ref }, { ref: "e999" }]) {
    const direct = await agent.call("read_text", input);
    const fallback = await agent.call("ayme_call", {
      tool: "read_text",
      input,
    });
    expect(fallback).toEqual(direct);
  }
});

test("ayme_call with an unknown tool names it and points to ayme_list_tools", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("ayme_call", {
    tool: "no_such_tool",
  });

  expect(isError).toBe(true);
  expect(text).toContain("no_such_tool");
  expect(text).toContain("ayme_list_tools");
});

test("with no page connected, page tools and fallback tools say to call ayme_connect", async ({
  agent,
}) => {
  for (const [name, input] of [
    ["ayme_list_tools", {}],
    ["ayme_call", { tool: "snapshot" }],
    ["snapshot", {}],
  ] as const) {
    const { text, isError } = await agent.call(name, input);
    expect(isError, name).toBe(true);
    expect(text, name).toContain("ayme_connect");
  }
});

test("a page tool the agent listed before the page left says to call ayme_connect", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  expect(await agent.pageToolNames()).toContain("snapshot");

  await page.close();
  await expect.poll(() => agent.pageToolNames()).toEqual([]);

  const { text, isError } = await agent.call("snapshot");
  expect(isError).toBe(true);
  expect(text).toContain("ayme_connect");
  expect(text).not.toContain("Unknown tool");
});
