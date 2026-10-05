import { request } from "node:http";

import type { Page } from "@playwright/test";

import {
  expect,
  holdCall,
  serverAddress,
  startAgent,
  test,
  unanswered,
  type Agent,
  storedPairing,
} from "./fixtures";

/** A host that is not localhost, which the browser resolves to this machine. */
const OTHER_HOST = "ayme.test";
test.use({
  launchOptions: {
    args: [`--host-resolver-rules=MAP ${OTHER_HOST} 127.0.0.1`],
  },
  // A page finds a server by itself only in the range it scans.
  inScanRange: true,
});

/** Resolves once the page's auto-pair scan got its answer from each of `ports`. */
function scanAnswers(page: Page, ports: readonly number[]) {
  return Promise.all(
    ports.map(
      (port) =>
        new Promise<void>((resolve) =>
          page.on("websocket", (socket) => {
            if (socket.url() !== `ws://127.0.0.1:${port}/probe`) return;
            socket.on("close", () => resolve());
          })
        )
    )
  );
}

/** Sets the page's heading, to tell pages apart in a snapshot. */
async function setHeading(page: Page, text: string) {
  await page.evaluate((text) => {
    document.querySelector("h1")!.textContent = text;
  }, text);
}

async function snapshotOf(agent: Agent) {
  const { text, isError } = await agent.call("snapshot");
  expect(isError, text).toBe(false);
  return JSON.parse(text).structure as string;
}

test("a localhost page pairs by itself when exactly one server is running", async ({
  agent,
  page,
  scanReaches,
}) => {
  const { address, port } = await serverAddress(agent);
  scanReaches.add(port);

  await page.goto("/");

  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain("snapshot");
  await setHeading(page, "Paired by itself");
  expect(await snapshotOf(agent)).toContain('heading "Paired by itself"');
  const stored = await storedPairing(page);
  expect(JSON.parse(stored!)).toMatchObject({ address });
});

test("an auto-paired tab reloads and reconnects to its own server, with or without a call in flight", async ({
  agent,
  page,
  scanReaches,
}) => {
  const { port } = await serverAddress(agent);
  scanReaches.add(port);
  await page.goto("/");
  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain("snapshot");
  const { answer: call } = await holdCall(agent, page);

  await page.reload();

  const answer = unanswered(await call);
  expect(answer.error).toMatch(/^The page reloaded/);
  expect(answer.tools).toContain("snapshot");

  await page.reload();
  await setHeading(page, "Reloaded twice");
  await expect
    .poll(() => snapshotOf(agent).catch(() => ""), { message: agent.log })
    .toContain('heading "Reloaded twice"');
  const stored = await storedPairing(page);
  // The server handed the tab its token, which the tab reconnects with.
  expect(JSON.parse(stored!).token).toMatch(/^[\w-]+$/);
});

test("an auto-paired tab whose server another one replaced on its port stays unpaired when two servers run", async ({
  agent,
  page,
  scanReaches,
}) => {
  const { port } = await serverAddress(agent);
  scanReaches.add(port);
  await page.goto("/");
  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain("snapshot");
  const second = await startAgent();
  await agent.close();
  const third = await startAgent("--port", String(port));
  try {
    const secondPort = (await serverAddress(second)).port;
    scanReaches.add(secondPort);
    const answered = scanAnswers(page, [port, secondPort]);

    await page.reload();
    await answered;
    await page.waitForTimeout(500);

    expect(await third.pageToolNames()).toEqual([]);
    expect(await second.pageToolNames()).toEqual([]);
    expect(await storedPairing(page)).toBeNull();
  } finally {
    await second.close();
    await third.close();
  }
});

test("while an auto-paired tab reloads, another localhost tab that loads does not pair, and the first tab reconnects", async ({
  agent,
  context,
  page,
  scanReaches,
}) => {
  const { port } = await serverAddress(agent);
  scanReaches.add(port);
  await page.goto("/");
  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain("snapshot");
  // Holds the reloaded document's startup, so the tab stays away while the
  // other tab loads and scans.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/main.ts*", async (route) => {
    await held;
    await route.continue();
  });
  const other = await context.newPage();
  // The other tab's sockets to the server, besides its scan's probe.
  const pairingSockets: string[] = [];
  other.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (Number(url.port) === port && url.pathname !== "/probe")
      pairingSockets.push(socket.url());
  });
  const answered = scanAnswers(other, [port]);

  const reloaded = page.reload();
  await expect.poll(() => agent.pageToolNames()).toEqual([]);
  await other.goto("/");
  await answered;
  release();
  await reloaded;
  await setHeading(page, "Back after the reload");

  await expect
    .poll(() => snapshotOf(agent).catch(() => ""), { message: agent.log })
    .toContain('heading "Back after the reload"');
  expect(pairingSockets).toEqual([]);
  expect(await storedPairing(other)).toBeNull();
});

test("a server paired by link stays with its tab when another localhost tab loads, whose scan does not count it", async ({
  agent,
  connect,
  context,
  page,
  scanReaches,
}) => {
  const { port } = await serverAddress(agent);
  scanReaches.add(port);
  await connect("/");
  await setHeading(page, "Paired by link");
  const other = await context.newPage();
  const answered = scanAnswers(other, [port]);

  await other.goto("/");
  await answered;
  await other.waitForTimeout(500);

  expect(await storedPairing(other)).toBeNull();
  expect(await snapshotOf(agent)).toContain('heading "Paired by link"');
  expect(await storedPairing(page)).not.toBeNull();
});

test("with two servers running, an open localhost page stays unpaired, and each server pairs with its own page through its link", async ({
  agent,
  connect,
  context,
  page,
  baseURL,
  scanReaches,
}) => {
  const other = await startAgent();
  try {
    const ports = [
      (await serverAddress(agent)).port,
      (await serverAddress(other)).port,
    ];
    for (const port of ports) scanReaches.add(port);
    const answered = scanAnswers(page, ports);

    await page.goto("/");
    await answered;
    await page.waitForTimeout(500);

    expect(await agent.pageToolNames()).toEqual([]);
    expect(await other.pageToolNames()).toEqual([]);
    expect(await storedPairing(page)).toBeNull();

    await connect("/");
    const otherPage = await context.newPage();
    const { text: otherLink } = await other.call("ayme_connect", {
      url: `${baseURL}/`,
    });
    await otherPage.goto(otherLink);
    await expect
      .poll(() => other.pageToolNames(), { message: other.log })
      .toContain("snapshot");

    await setHeading(page, "First agent's page");
    await setHeading(otherPage, "Second agent's page");
    expect(await snapshotOf(agent)).toContain("First agent's page");
    expect(await snapshotOf(other)).toContain("Second agent's page");
  } finally {
    await other.close();
  }
});

test("a page not on localhost or 127.0.0.1 never auto-pairs", async ({
  agent,
  page,
  baseURL,
  scanReaches,
}) => {
  const { address, port } = await serverAddress(agent);
  scanReaches.add(port);
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  const otherOrigin = `http://${OTHER_HOST}:${new URL(baseURL!).port}`;

  await page.goto(`${otherOrigin}/`);
  await expect(page.locator("html[data-fixture=ready]")).toBeAttached();
  await page.waitForLoadState("networkidle");

  expect(sockets.filter((url) => url.startsWith("ws://127.0.0.1"))).toEqual([]);
  expect(await agent.pageToolNames()).toEqual([]);

  // The page itself cannot connect without the token either.
  const opened = await page.evaluate(
    (url) =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket(url);
        socket.addEventListener("open", () => resolve(true));
        socket.addEventListener("close", () => resolve(false));
      }),
    `${address}/`
  );
  expect(opened).toBe(false);
  expect(await agent.pageToolNames()).toEqual([]);

  // A connect link still pairs it: the token works from any origin.
  const { text: link } = await agent.call("ayme_connect", {
    url: `${otherOrigin}/`,
  });
  await page.goto(link);
  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain("snapshot");
});

/** The status the server answers a WebSocket handshake on `path` with. */
function handshake(address: string, path: string, origin?: string) {
  const { hostname, port } = new URL(address);
  return new Promise<number>((resolve, reject) => {
    const handshakeRequest = request({
      hostname,
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...(origin ? { Origin: origin } : {}),
      },
    });
    handshakeRequest.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode!);
    });
    handshakeRequest.on("response", (response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    handshakeRequest.on("error", reject);
    handshakeRequest.end();
  });
}

test("the server accepts a connection without a token only from a localhost or 127.0.0.1 origin", async ({
  agent,
}) => {
  const { address } = await serverAddress(agent);

  expect(await handshake(address, "/", `http://${OTHER_HOST}:5173`)).toBe(401);
  expect(await handshake(address, "/", "https://example.com")).toBe(401);
  expect(await handshake(address, "/")).toBe(401);
  expect(await handshake(address, "/", "http://localhost:5173")).toBe(101);
  expect(await handshake(address, "/", "http://127.0.0.1:8080")).toBe(101);
});
