import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";

import { scriptedBrowser } from "../../../testing";
import { agentAppPage } from "./agentAppPage";
import { serveSession } from "./background";
import {
  claimRecord,
  privateFolder,
  releaseRecord,
  thisProcess,
  type SessionPlace,
} from "./record";

// Who reaches a Session's Inspector: a window at the address `ayme inspect`
// prints, which its own origin admits, and the view an Agent App shows in
// its chat (`ayme mcp`), which the Session's token admits (ADR-0072). Only
// the commands' private socket hands out the token. On a Session that runs
// on the scripted browser in this process.

/** The Inspector's built script, with what would end its element early. */
const SCRIPT = 'console.log("</script><!-- the Inspector");';

const place: SessionPlace = { projectDir: "", name: "shop" };
beforeEach(() => {
  const made = realpathSync(mkdtempSync(join(tmpdir(), "ayme-admission-")));
  onTestFinished(() => rmSync(made, { recursive: true, force: true }));
  vi.stubEnv("AYME_CACHE_DIR", join(made, "cache"));
  writeFileSync(join(made, "external.mjs"), SCRIPT);
  Object.assign(place, { projectDir: made });
});

const script = () => join(place.projectDir, "external.mjs");

/** Claims the folder's Session named shop for this process and serves it,
 * with its window, until the test ends. Resolves with the address `ayme
 * inspect` prints and the socket `ayme mcp` gives an Agent App. */
async function serveShop() {
  const { folder, socket } = privateFolder();
  const claim = claimRecord(place, { ...thisProcess(), socket });
  if (!("generation" in claim)) throw new Error("the folder has a Session");
  const scope = Effect.runSync(Scope.make());
  onTestFinished(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    releaseRecord(place, claim.generation);
    rmSync(folder, { recursive: true, force: true });
  });
  const { layer, browser } = scriptedBrowser();
  const session = await Effect.runPromise(
    serveSession({
      socket,
      request: { open: { headed: false } },
      name: "shop",
      inspectorScript: script(),
    }).pipe(Effect.provide(layer), Scope.provide(scope))
  );
  const ask = async (request: Parameters<typeof session.ask>[0]) => {
    const answer = await Effect.runPromise(session.ask(request));
    if (!answer.ok) throw new Error(answer.text);
    return answer.data as Record<string, string>;
  };
  const { address } = await ask({ inspector: { window: {} } });
  const { socket: agentAppSocket } = await ask({
    inspector: { agentApp: {} },
  });
  return { browser, address: address!, agentAppSocket: agentAppSocket! };
}

function socketOf(address: string, token?: string) {
  const url = new URL("/inspector/ws", address);
  url.protocol = "ws:";
  if (token !== undefined) url.searchParams.set("token", token);
  return url;
}

/** Resolves with "open", or with the error the server's refusal gives. */
async function connect(url: URL | string, origin?: string, host?: string) {
  const headers = {
    ...(origin === undefined ? {} : { origin }),
    ...(host === undefined ? {} : { host }),
  };
  const ws = new WebSocket(url, { headers });
  onTestFinished(() => ws.terminate());
  const outcome = await new Promise<string>((resolve) => {
    ws.once("open", () => resolve("open"));
    ws.once("error", (error) => resolve(error.message));
  });
  return { ws, outcome };
}

/** The Session's token in the socket `ayme mcp` gives an Agent App. */
const tokenIn = (socket: string) => new URL(socket).searchParams.get("token")!;

const REFUSED = "Unexpected server response: 403";

it("ayme inspect gives the window's page, with no secret, and ayme mcp the socket with the Session's token", async () => {
  const { address, agentAppSocket } = await serveShop();

  const { port } = new URL(address);
  expect(address).toBe(`http://127.0.0.1:${port}/inspector`);
  expect(agentAppSocket).toMatch(
    new RegExp(`^ws://127\\.0\\.0\\.1:${port}/inspector/ws\\?token=[\\w-]{32}$`)
  );
});

it("admits any number of windows of the page's own origin, with no secret, for as long as the Session runs", async () => {
  const { address } = await serveShop();
  const origin = new URL(address).origin;

  for (const window of ["first", "second", "third"])
    expect((await connect(socketOf(address), origin)).outcome, window).toBe(
      "open"
    );
});

it("refuses a socket without the token from another origin, from an Agent App's frame and from no page", async () => {
  const { address } = await serveShop();
  const { port } = new URL(address);

  for (const origin of [
    "http://evil.test",
    "null",
    undefined,
    // The window's own address in every other spelling.
    `https://127.0.0.1:${port}`,
    `http://127.0.0.1:${Number(port) + 1}`,
    "http://127.0.0.1",
    `http://127.0.0.1.:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ])
    expect((await connect(socketOf(address), origin)).outcome, origin).toBe(
      REFUSED
    );
});

it("refuses a socket of the window's own origin that names another host, as a page that points a name of its own at the port does", async () => {
  const { address } = await serveShop();
  const { port } = new URL(address);

  for (const name of ["evil.test", "localhost", "127.0.0.1.", "[::1]"])
    expect(
      (
        await connect(
          socketOf(address),
          `http://${name}:${port}`,
          `${name}:${port}`
        )
      ).outcome,
      name
    ).toBe(REFUSED);
  expect(
    (
      await connect(
        socketOf(address),
        new URL(address).origin,
        `evil.test:${port}`
      )
    ).outcome
  ).toBe(REFUSED);
});

it("admits a socket that brings the token from any origin or none", async () => {
  const { agentAppSocket } = await serveShop();

  for (const origin of ["http://evil.test", "null", undefined])
    expect((await connect(agentAppSocket, origin)).outcome, origin).toBe(
      "open"
    );
});

it("refuses a socket whose token is wrong", async () => {
  const { address } = await serveShop();

  // The second has a token's length, so it reaches the comparison.
  for (const token of ["guessed", "x".repeat(32)])
    expect(
      (await connect(socketOf(address, token), "null")).outcome,
      token
    ).toBe(REFUSED);
});

it("answers the window and an Agent App's view alike", async () => {
  const { address, agentAppSocket, browser } = await serveShop();

  for (const [url, origin] of [
    [socketOf(address), new URL(address).origin],
    [agentAppSocket, "null"],
  ] as const) {
    const { ws, outcome } = await connect(url, origin);
    expect(outcome, origin).toBe("open");
    const told: unknown[] = [];
    ws.on("message", (data) => told.push(JSON.parse(String(data))));
    // A window's request names the Tab the Session told it.
    await expect.poll(() => told).toContainEqual({ tab: 1 });
    ws.send(JSON.stringify({ id: 1, method: "getState", tab: 1 }));
    await expect.poll(() => told).toContainEqual({ id: 1, result: "getState" });
  }
  expect(browser.inspectorCalls).toHaveLength(2);
});

it("the token opens the socket only, never the window's page or script for another origin", async () => {
  const { address, agentAppSocket } = await serveShop();

  for (const path of ["/inspector", "/inspector/external.mjs"]) {
    const url = new URL(path, address);
    url.searchParams.set("token", tokenIn(agentAppSocket));
    const response = await fetch(url, {
      headers: { origin: "http://evil.test" },
    });
    expect(response.status, path).toBe(403);
  }
});

it("the window's page holds no token and may not be framed", async () => {
  const { address, agentAppSocket } = await serveShop();

  const page = await fetch(address);

  expect(page.headers.get("content-security-policy")).toBe(
    "frame-ancestors 'none'"
  );
  expect(await page.text()).not.toContain(tokenIn(agentAppSocket));
});

it("the page an Agent App shows holds the Inspector's script and the socket it connects to, and names the Session", async () => {
  const { agentAppSocket } = await serveShop();

  const { html, connectDomains } = await agentAppPage(place, script());

  expect(connectDomains).toEqual([new URL(agentAppSocket).origin]);
  expect(html).toContain("<title>ayme inspect: shop</title>");
  expect(html).toContain('<meta name="ayme-session" content="shop" />');
  expect(html).toContain(
    `<script type="application/json" id="ayme-inspector-app">${JSON.stringify({ socket: agentAppSocket })}</script>`
  );
  // The script stays inside its element.
  expect(html).toContain(
    '<script type="module">console.log("\\u003C/script>\\u003C!-- the Inspector");</script>'
  );
});

it("with no Session of that name, the page an Agent App shows says so and connects nowhere", async () => {
  const { html, connectDomains } = await agentAppPage(place, script());

  expect(connectDomains).toEqual([]);
  expect(html).toContain('<p role="status"');
  expect(html).toContain(
    `>No Session named shop is open in ${place.projectDir}. Start one with ayme -s=shop open. Then ask your agent to show the Inspector again.</p>`
  );
  expect(html).not.toContain("<script");
});
