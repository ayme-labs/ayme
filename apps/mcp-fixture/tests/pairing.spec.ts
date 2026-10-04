import { expect, test } from "./fixtures";

test.describe("on the default port", () => {
  // Without --port the server takes a port of the range a page scans.
  test.use({ inScanRange: true });

  test("ayme_connect returns the app URL with the server's loopback address and token", async ({
    agent,
    baseURL,
  }) => {
    const { text } = await agent.call("ayme_connect", {
      url: `${baseURL}/?view=list`,
    });
    const match = /^(.+)#ayme=ws:\/\/127\.0\.0\.1:(\d+)\/[\w-]+$/.exec(text);
    expect(match, text).not.toBeNull();
    expect(match![1]).toBe(`${baseURL}/?view=list`);
    expect(Number(match![2])).toBeGreaterThanOrEqual(9350);
    expect(Number(match![2])).toBeLessThanOrEqual(9365);
  });
});

test("opening the connect link pairs the tab, keeps the pairing for the tab and cleans the address bar", async ({
  connect,
  page,
  baseURL,
}) => {
  const link = await connect("/?view=list");

  expect(page.url()).toBe(`${baseURL}/?view=list`);
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("ayme:agent-connection")
  );
  const { address, token } = JSON.parse(stored!) as Record<string, string>;
  expect(link).toBe(`${baseURL}/?view=list#ayme=${address}/${token}`);
});

test("pasting the connect link into an open tab pairs it without a reload", async ({
  agent,
  connect,
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html[data-fixture=ready]")).toBeAttached();
  await page.evaluate(() => Object.assign(window, { beforePairing: true }));

  await connect("/");

  expect(await page.evaluate(() => "beforePairing" in window)).toBe(true);
  expect(await agent.pageToolNames()).toContain("snapshot");
});

test("the server accepts a page only with its token", async ({
  agent,
  page,
  baseURL,
}) => {
  const { text: link } = await agent.call("ayme_connect", {
    url: `${baseURL}/`,
  });
  const forged = link.replace(/\/[\w-]+$/, "/not-the-token");
  const rejected = new Promise<void>((resolve) =>
    page.on("websocket", (socket) => {
      if (!socket.url().endsWith("/not-the-token")) return;
      socket.on("close", () => resolve());
      socket.on("socketerror", () => resolve());
    })
  );
  await page.goto(forged);
  await rejected;

  expect(await agent.pageToolNames()).toEqual([]);
});
