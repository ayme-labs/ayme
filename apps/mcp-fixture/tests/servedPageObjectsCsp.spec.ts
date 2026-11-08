import { expect, startServingAgent, test } from "./fixtures";

// `plain.html`, a page without Ayme, sent with a Content Security Policy that
// allows scripts and connections only to the page's own origin. The served
// runtime and the socket to `ayme mcp` are on another origin.
const STRICT_PAGE = "/plain.html?strict-csp";

/** The Page Object Tool of the served entry's `PlainPage`. */
const PLAIN_PAGE_TOOL = "PlainPage.readNote";

// The tab pairs by link, so it never scans; without the scan's routing, its
// WebSockets are the browser's own, which the page's policy governs.
test.use({ limitScan: false });

test("on a page with a strict Content Security Policy, the tab does not pair without bypassCSP", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const { agent } = await startServingAgent(context, testInfo);
  try {
    const refused = page.waitForEvent("console", (message) =>
      message.text().includes("did not load")
    );
    const { text: link } = await agent.call("ayme_connect", {
      url: `${baseURL}${STRICT_PAGE}`,
    });

    await page.goto(link);
    await refused;

    expect(await agent.pageToolNames()).toEqual([]);
    await expect(page).toHaveURL(/#ayme=/);
  } finally {
    await agent.close();
  }
});

test.describe("with bypassCSP", () => {
  test.use({ bypassCSP: true });

  test("on a page with a strict Content Security Policy, the tab pairs and a served Page Object Tool runs", async ({
    context,
    page,
    baseURL,
  }, testInfo) => {
    const { agent } = await startServingAgent(context, testInfo);
    try {
      const { text: link } = await agent.call("ayme_connect", {
        url: `${baseURL}${STRICT_PAGE}`,
      });

      await page.goto(link);
      await expect
        .poll(() => agent.pageToolNames(), { message: agent.log })
        .toContain(PLAIN_PAGE_TOOL);

      const { text, isError } = await agent.call(PLAIN_PAGE_TOOL);
      expect(isError, text).toBe(false);
      expect(text).toContain("does not run Ayme");
    } finally {
      await agent.close();
    }
  });
});
