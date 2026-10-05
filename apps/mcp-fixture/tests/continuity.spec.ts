import type { WebSocketRoute } from "@playwright/test";

import { expect, holdCall, serverAddress, test, unanswered } from "./fixtures";

// Every page here pairs by link and keeps its pairing, so it never scans.
test.use({ limitScan: false });

test("after a reload the tab reconnects without a new link", async ({
  agent,
  connect,
  page,
}) => {
  await connect();

  await page.reload();

  await expect
    .poll(async () => (await agent.call("snapshot")).isError)
    .toBe(false);
  expect(await agent.pageToolNames()).toContain("read_text");
});

test("after its socket drops without a reload the page reconnects and reports its tools again", async ({
  agent,
  connect,
  page,
}) => {
  const servers: WebSocketRoute[] = [];
  const { port } = await serverAddress(agent);
  const toAymeServer = (url: URL) => Number(url.port) === port;
  await page.routeWebSocket(toAymeServer, (socket) => {
    servers.push(socket.connectToServer());
  });
  await connect();
  await page.evaluate(() => Object.assign(window, { beforeDrop: true }));

  // Closing the server side closes the page's socket too.
  await servers.at(-1)!.close();

  await expect.poll(() => servers.length).toBe(2);
  await expect
    .poll(() => agent.pageToolNames())
    .toEqual(expect.arrayContaining(["snapshot", "read_text"]));
  expect(await page.evaluate(() => "beforeDrop" in window)).toBe(true);
});

test("after a same-tab navigation the new page's tools replace the old ones", async ({
  agent,
  connect,
  page,
}) => {
  await connect();

  await page.goto("/other");

  await expect
    .poll(() => agent.pageToolNames())
    .toEqual(expect.arrayContaining(["snapshot", "read_other"]));
  expect(await agent.pageToolNames()).not.toContain("read_text");
});

test("a call in flight when the page reloads is answered with the reloaded page's tools", async ({
  agent,
  baseURL,
  connect,
  page,
}) => {
  await connect();
  const { answer: call } = await holdCall(agent, page);

  await page.reload();

  const answer = unanswered(await call);
  expect(answer).toMatchObject({ settled: false, loading: `${baseURL}/` });
  expect(answer.error).toMatch(/^The page reloaded .*outcome is unknown/);
  expect(answer.tools).toEqual(
    expect.arrayContaining(["snapshot", "read_text"])
  );
});

test("a call in flight when the page navigates is answered with the new page's tools", async ({
  agent,
  baseURL,
  connect,
  page,
}) => {
  await connect();
  const { answer: call } = await holdCall(agent, page);

  await page.goto("/other");

  const answer = unanswered(await call);
  expect(answer).toMatchObject({
    settled: false,
    loading: `${baseURL}/other`,
  });
  expect(answer.error).toMatch(
    /^The page navigated to .*\/other .*outcome is unknown/
  );
  expect(answer.tools).toEqual(
    expect.arrayContaining(["snapshot", "read_other"])
  );
});

test("a call in flight when the page starts loading another document gets the page's own loading answer", async ({
  agent,
  baseURL,
  connect,
  page,
}) => {
  await connect();
  const { answer: call } = await holdCall(agent, page);

  await page.evaluate(() => setTimeout(() => location.assign("/plain.html")));

  // The runtime answers a call at the start of a full load (#444), before the
  // document goes away, so the server has nothing left to answer.
  const { text, isError } = await call;
  expect(isError, text).toBe(false);
  const answer = JSON.parse(text) as Record<string, unknown>;
  expect(answer).toMatchObject({
    settled: false,
    loading: `${baseURL}/plain.html`,
  });
  expect(answer.next).toContain("snapshot");
});

test("a call in flight when the tab closes says the tab closed, and the connection ends", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  const { answer: call } = await holdCall(agent, page);

  await page.close();

  const answer = unanswered(await call);
  expect(answer.error).toMatch(/^The tab closed.*outcome is unknown/);
  expect(answer.next).toContain("ayme_connect");
  expect(await agent.pageToolNames()).toEqual([]);
  expect((await agent.call("snapshot")).isError).toBe(true);
});
