import { readFileSync } from "node:fs";

import {
  publishedToolNames,
  recordPublishedTools,
} from "@ayme-dev/webmcp/testing";

import { SERVER_TOOLS, addItemRef, expect, test } from "./fixtures";

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
  const ref = await addItemRef(agent);

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

test("screenshot returns the page as an MCP image and saves it to a file", async ({
  agent,
  connect,
}) => {
  await connect();

  const result = await agent.client.callTool({
    name: "screenshot",
    arguments: { filename: "mcp-fixture.png" },
  });
  const [image, line] = result.content as {
    type: string;
    data?: string;
    mimeType?: string;
    text?: string;
  }[];

  expect(result.isError).not.toBe(true);
  expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(image?.data?.length).toBeGreaterThan(0);
  const path = line?.text?.match(/saved to (.+\.png)\.$/)?.[1];
  expect(path, line?.text).toBeDefined();
  expect(readFileSync(path!).toString("base64")).toBe(image?.data);
});
