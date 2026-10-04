import {
  publishedToolNames,
  recordPublishedTools,
} from "@ayme-dev/ayme/testing";

import { SERVER_TOOLS, expect, test } from "./fixtures";

test("the page's built-in tools and Custom Tools are MCP tools under the page's names", async ({
  agent,
  connect,
}) => {
  await connect();

  const names = await agent.toolNames();
  expect(names).toEqual(
    expect.arrayContaining(["snapshot", "click", "read_text"])
  );
  expect(names.filter((name) => SERVER_TOOLS.includes(name))).toEqual(
    SERVER_TOOLS
  );
});

test("calling a built-in tool runs it on the page and returns its result", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("snapshot");

  expect(isError).toBe(false);
  expect(JSON.parse(text).structure).toContain('heading "Groceries"');
});

test("calling a Custom Tool runs it on the page and returns its result", async ({
  agent,
  connect,
}) => {
  await connect();
  const { text: snapshot } = await agent.call("snapshot");
  const ref = /(e\d+) button "Add item"/.exec(
    JSON.parse(snapshot).structure
  )?.[1];
  expect(ref, snapshot).toBeDefined();

  const { text, isError } = await agent.call("read_text", { ref });

  expect(isError, text).toBe(false);
  expect(JSON.parse(text)).toMatchObject({ result: "Add item" });
});

test("a page tool's failure comes back as an MCP error result", async ({
  agent,
  connect,
}) => {
  await connect();

  const { text, isError } = await agent.call("read_text", { ref: "e999" });

  expect(isError).toBe(true);
  expect(text).toContain("e999");
});

test("the server's own tools are never published to the page's WebMCP tools", async ({
  connect,
  context,
  page,
}) => {
  await recordPublishedTools(context);
  await connect("/?webmcp");

  await expect.poll(() => publishedToolNames(page)).toContain("snapshot");
  for (const name of SERVER_TOOLS)
    expect(await publishedToolNames(page)).not.toContain(name);
});
