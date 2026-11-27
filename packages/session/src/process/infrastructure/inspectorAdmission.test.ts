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

// Who reaches a Session's Inspector: the window `ayme inspect` opens and
// the view an Agent App shows in its chat (`ayme mcp`), each admitted to the
// window's socket by the Session's token alone (ADR-0072), which only the
// commands' private socket hands out. On a Session that runs on the
// scripted browser in this process.

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
 * with its window, until the test ends. Resolves with where `ayme inspect`
 * opens the window and the socket `ayme mcp` gives an Agent App. */
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

/** The window's socket, with `token` when given, as `origin` reaches it. */
function socketOf(address: string, token?: string) {
  const url = new URL("/inspector/ws", address);
  url.protocol = "ws:";
  if (token !== undefined) url.searchParams.set("token", token);
  return url;
}

/** Connects to `url` as `origin`, and resolves with the socket once open,
 * or with the error the server's refusal gives. */
async function connect(url: URL | string, origin?: string) {
  const ws = new WebSocket(url, origin ? { headers: { origin } } : {});
  onTestFinished(() => ws.terminate());
  const outcome = await new Promise<string>((resolve) => {
    ws.once("open", () => resolve("open"));
    ws.once("error", (error) => resolve(error.message));
  });
  return { ws, outcome };
}

const tokenIn = (address: string) =>
  new URLSearchParams(new URL(address).hash.slice(1)).get("token")!;

it("ayme inspect opens the window with the Session's token in the address's fragment, which no request carries, and ayme mcp gets the same token in its socket", async () => {
  const { address, agentAppSocket } = await serveShop();

  const { port } = new URL(address);
  expect(address).toMatch(
    new RegExp(`^http://127\\.0\\.0\\.1:${port}/inspector#token=[\\w-]{32}$`)
  );
  expect(agentAppSocket).toBe(socketOf(address, tokenIn(address)).href);
});

it("refuses a socket that brings no token, from no page, from the window's own page or from an Agent App's frame", async () => {
  const { address } = await serveShop();

  for (const origin of [undefined, new URL(address).origin, "null"])
    expect((await connect(socketOf(address), origin)).outcome, origin).toBe(
      "Unexpected server response: 403"
    );
});

it("refuses a socket whose token is wrong", async () => {
  const { address } = await serveShop();

  expect((await connect(socketOf(address, "guessed"), "null")).outcome).toBe(
    "Unexpected server response: 403"
  );
});

it("admits the window and an Agent App's view, from any origin, once each brings the token, and answers both", async () => {
  const { address, agentAppSocket, browser } = await serveShop();

  for (const [url, origin] of [
    [socketOf(address, tokenIn(address)), new URL(address).origin],
    [agentAppSocket, "null"],
  ] as const) {
    const { ws, outcome } = await connect(url, origin);
    expect(outcome, origin).toBe("open");
    const told: unknown[] = [];
    ws.on("message", (data) => told.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ id: 1, method: "getState" }));
    await expect.poll(() => told).toEqual([{ id: 1, result: "getState" }]);
  }
  expect(browser.inspectorCalls).toHaveLength(2);
});

it("the token opens the socket only, never the window's page or script for another origin", async () => {
  const { address } = await serveShop();

  for (const path of ["/inspector", "/inspector/external.mjs"]) {
    const url = new URL(path, address);
    url.searchParams.set("token", tokenIn(address));
    const response = await fetch(url, {
      headers: { origin: "http://evil.test" },
    });
    expect(response.status, path).toBe(403);
  }
});

it("the window's page holds no token and may not be framed", async () => {
  const { address } = await serveShop();

  const page = await fetch(address);

  expect(page.headers.get("content-security-policy")).toBe(
    "frame-ancestors 'none'"
  );
  expect(await page.text()).not.toContain(tokenIn(address));
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
