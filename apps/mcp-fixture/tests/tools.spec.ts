import {
  publishedToolNames,
  recordPublishedTools,
} from "@ayme-dev/webmcp/testing";

import { SERVER_TOOLS, expect, test } from "./fixtures";

test("the page's Page Object Tools and page_objects are MCP tools under the page's names", async ({
  agent,
  connect,
}) => {
  await connect();

  const names = await agent.toolNames();
  expect(names).toEqual(
    expect.arrayContaining(["page_objects", "GroceriesPage.readHeading"])
  );
  expect(names.filter((name) => SERVER_TOOLS.includes(name))).toEqual(
    SERVER_TOOLS
  );
});

test("calling a Page Object Tool runs it on the page and returns its result", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("GroceriesPage.readHeading");

  expect(isError, text).toBe(false);
  expect(JSON.parse(text)).toMatchObject({
    settled: true,
    result: "Groceries",
  });
});

test("a page tool's failure comes back as an MCP error result", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("GroceriesPage.fail");

  expect(isError).toBe(true);
  expect(text).toContain("The fixture's action failed.");
});

test("the server's own tools are never published to the page's WebMCP tools", async ({
  connect,
  context,
  page,
}) => {
  await recordPublishedTools(context);
  await connect("/?webmcp");

  await expect.poll(() => publishedToolNames(page)).toContain("page_objects");
  for (const name of SERVER_TOOLS)
    expect(await publishedToolNames(page)).not.toContain(name);
});
