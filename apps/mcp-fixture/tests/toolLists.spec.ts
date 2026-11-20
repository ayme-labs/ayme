import {
  publishedToolNames,
  recordPublishedTools,
} from "@ayme-dev/webmcp/testing";

import {
  SERVER_TOOLS,
  connectPage,
  expect,
  serverAddress,
  startServingAgent,
  test,
  type Agent,
} from "./fixtures";

/**
 * What `ayme mcp` lists of the fixture page only with `--browser-tools`: a
 * Browser Tool, `snapshot` and a Custom Tool. The page has no `goal`, which
 * needs a model.
 */
const AYMES_OWN_BROWSER_DRIVING = ["click", "snapshot", "read_text"];

/** Waits until the agent's server lists `name`. */
async function listed(agent: Agent, name: string) {
  await expect
    .poll(() => agent.toolNames(), { message: agent.log, timeout: 15_000 })
    .toContain(name);
}

test.describe("without --browser-tools", () => {
  test.use({ browserTools: false });

  test("a page that ships Ayme pairs through ayme_connect, and the agent sees its Page Object Tools, page_objects, Peek Tools and an App Process's tools, but none of Ayme's own browser driving", async ({
    agent,
    connect,
    page,
    startStandInAppProcess,
  }) => {
    await connect("/?peek=cart");
    await page.getByRole("button", { name: "Show basket" }).click();
    startStandInAppProcess({ port: (await serverAddress(agent)).port });

    await listed(agent, "Basket.readHeading");
    await listed(agent, "peek.node.jobs");
    const names = await agent.toolNames();
    expect(names).toEqual(
      expect.arrayContaining([
        ...SERVER_TOOLS,
        "Basket.readHeading",
        "page_objects",
        "peek.cart",
        "peek.node.jobs",
      ])
    );
    for (const name of AYMES_OWN_BROWSER_DRIVING)
      expect(names).not.toContain(name);

    const { text: tree, isError } = await agent.call("page_objects");
    expect(isError, tree).toBe(false);
    expect(tree).toContain("Basket");
    const { text: heading } = await agent.call("Basket.readHeading");
    expect(heading).toContain("Groceries");
    const { text: listing } = await agent.call("ayme_list_tools");
    expect(
      (JSON.parse(listing) as { name: string }[]).map(({ name }) => name)
    ).not.toContain("snapshot");
    expect(await agent.call("snapshot")).toMatchObject({
      text: 'Unknown tool "snapshot".',
      isError: true,
    });
  });

  test("a page that loads the served Page Objects gets their tools and page_objects, and no WebMCP publication", async ({
    context,
    page,
    baseURL,
  }, testInfo) => {
    await recordPublishedTools(context);
    const { agent } = await startServingAgent(context, testInfo);
    try {
      await connectPage(agent, page, `${baseURL}/plain.html`);
      await listed(agent, "PlainPage.readNote");

      const names = await agent.toolNames();
      expect(names).toEqual(
        expect.arrayContaining([...SERVER_TOOLS, "page_objects"])
      );
      for (const name of AYMES_OWN_BROWSER_DRIVING)
        expect(names).not.toContain(name);
      expect(await publishedToolNames(page)).toEqual([]);
    } finally {
      await agent.close();
    }
  });
});

test("with --browser-tools, the agent also sees Ayme's Browser Tools, snapshot and Custom Tools, and they work", async ({
  agent,
  connect,
}) => {
  await connect("/");

  const names = await agent.toolNames();
  expect(names).toEqual(
    expect.arrayContaining([
      ...SERVER_TOOLS,
      "page_objects",
      ...AYMES_OWN_BROWSER_DRIVING,
    ])
  );
  const { text: snapshot } = await agent.call("snapshot");
  const ref = /(e\d+) heading "Groceries"/.exec(
    JSON.parse(snapshot).structure
  )?.[1];
  expect(ref, snapshot).toBeDefined();
  const { text, isError } = await agent.call("read_text", { ref });
  expect(isError, text).toBe(false);
  expect(text).toContain("Groceries");
  const clicked = await agent.call("click", { target: ref });
  expect(clicked.isError, clicked.text).toBe(false);
});
