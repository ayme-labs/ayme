import { connectPage, expect, startServingAgent, test } from "./fixtures";

/** The Page Object Tool of the served entry's `PlainPage`. */
const PLAIN_PAGE_TOOL = "PlainPage.readNote";

test("a served page fetches the screenshot renderer only when screenshot is first called, and screenshot returns an image", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const { agent, server } = await startServingAgent(
    context,
    testInfo,
    "--browser-tools"
  );
  try {
    // The code the page fetches from ayme mcp, in the order it asks.
    const fetched: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(`${server}/`))
        fetched.push(new URL(request.url()).pathname);
    });
    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);
    expect((await agent.call(PLAIN_PAGE_TOOL)).isError).toBe(false);
    await page.waitForLoadState("networkidle");
    const onLoad = [...fetched];

    const result = await agent.client.callTool({
      name: "screenshot",
      arguments: {},
    });

    const [image] = result.content as {
      type: string;
      data?: string;
      mimeType?: string;
    }[];
    expect(result.isError).not.toBe(true);
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(image?.data?.length).toBeGreaterThan(0);
    // The renderer is what the first screenshot fetches: nothing the load did.
    expect(onLoad.length).toBeGreaterThan(0);
    const byScreenshot = fetched.slice(onLoad.length);
    expect(byScreenshot).not.toEqual([]);
    expect(byScreenshot.filter((path) => onLoad.includes(path))).toEqual([]);
  } finally {
    await agent.close();
  }
});
