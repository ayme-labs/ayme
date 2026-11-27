import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";

import { scriptedBrowser } from "../../../testing";
import { OPENING_CODE_LIFETIME_MS } from "../../session/domain";
import { agentAppPage } from "./agentAppPage";
import { serveSession } from "./background";
import {
  claimRecord,
  privateFolder,
  releaseRecord,
  thisProcess,
  type SessionPlace,
} from "./record";

// Who reaches a Session's Inspector: the window `ayme inspect` opens, which
// a one-use code admits, and the view an Agent App shows in its chat
// (`ayme mcp`), which the Session's token admits (ADR-0072). Only the
// commands' private socket hands out either. On a Session that runs on the
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
  /** Where `ayme inspect` opens a window, each time it asks. */
  const opening = async () =>
    (await ask({ inspector: { window: {} } })).address!;
  const address = await opening();
  const { socket: agentAppSocket } = await ask({
    inspector: { agentApp: {} },
  });
  return { browser, address, agentAppSocket: agentAppSocket!, opening };
}

/** The window's socket, with `credential` when given, such as
 * `{ token }` or `{ code }`. */
function socketOf(
  address: string,
  credential: Readonly<Record<string, string>> = {}
) {
  const url = new URL("/inspector/ws", address);
  url.protocol = "ws:";
  for (const [key, value] of Object.entries(credential))
    url.searchParams.set(key, value);
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

/** The one-use code in the fragment of the address `ayme inspect` opens. */
const codeIn = (address: string) =>
  new URLSearchParams(new URL(address).hash.slice(1)).get("code")!;

/** The Session's token in the socket `ayme mcp` gives an Agent App. */
const tokenIn = (socket: string) => new URL(socket).searchParams.get("token")!;

/** Connects to `url` as `origin`, and resolves with the first frame the
 * Session sent it. */
async function admitted(url: URL | string, origin?: string) {
  const ws = new WebSocket(url, origin ? { headers: { origin } } : {});
  onTestFinished(() => ws.terminate());
  const [data] = (await once(ws, "message")) as [Buffer];
  return { ws, first: JSON.parse(String(data)) as unknown };
}

it("ayme inspect opens the window with a one-use code in the address's fragment, not the Session's token, which ayme mcp gets in its socket", async () => {
  const { address, agentAppSocket, opening } = await serveShop();

  const { port } = new URL(address);
  expect(address).toMatch(
    new RegExp(`^http://127\\.0\\.0\\.1:${port}/inspector#code=[\\w-]{32}$`)
  );
  expect(agentAppSocket).toMatch(
    new RegExp(`^ws://127\\.0\\.0\\.1:${port}/inspector/ws\\?token=[\\w-]{32}$`)
  );
  expect(address).not.toContain(tokenIn(agentAppSocket));
  expect(codeIn(await opening())).not.toBe(codeIn(address));
});

it("a code admits one window, which the Session then tells its token, to connect again with after a reload or a dropped connection", async () => {
  const { address, agentAppSocket } = await serveShop();
  const origin = new URL(address).origin;

  const { first } = await admitted(
    socketOf(address, { code: codeIn(address) }),
    origin
  );

  expect(first).toEqual({ token: tokenIn(agentAppSocket) });
  const again = await admitted(
    socketOf(address, { token: (first as { token: string }).token }),
    origin
  );
  expect(again.first).not.toHaveProperty("token");
});

it("refuses a second client that brings a code already used, and admits the window of a new code", async () => {
  const { address, opening } = await serveShop();
  const origin = new URL(address).origin;
  await admitted(socketOf(address, { code: codeIn(address) }), origin);

  expect(
    (await connect(socketOf(address, { code: codeIn(address) }), origin))
      .outcome
  ).toBe("Unexpected server response: 403");
  const next = await opening();
  expect(
    (await connect(socketOf(next, { code: codeIn(next) }), origin)).outcome
  ).toBe("open");
});

it("refuses a code that ran out", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => void vi.useRealTimers());
  const { address, opening } = await serveShop();
  const origin = new URL(address).origin;
  const fresh = await opening();

  vi.advanceTimersByTime(OPENING_CODE_LIFETIME_MS - 1);
  expect(
    (await connect(socketOf(fresh, { code: codeIn(fresh) }), origin)).outcome
  ).toBe("open");
  vi.advanceTimersByTime(1);
  expect(
    (await connect(socketOf(address, { code: codeIn(address) }), origin))
      .outcome
  ).toBe("Unexpected server response: 403");
});

it("refuses a socket that brings no token or code, from no page, from the window's own page or from an Agent App's frame", async () => {
  const { address } = await serveShop();

  for (const origin of [undefined, new URL(address).origin, "null"])
    expect((await connect(socketOf(address), origin)).outcome, origin).toBe(
      "Unexpected server response: 403"
    );
});

it.each(["token", "code"])(
  "refuses a socket whose %s is wrong",
  async (credential) => {
    const { address } = await serveShop();

    expect(
      (await connect(socketOf(address, { [credential]: "guessed" }), "null"))
        .outcome
    ).toBe("Unexpected server response: 403");
  }
);

it("admits the window and an Agent App's view, from any origin, once each brings its code or the token, and answers both", async () => {
  const { address, agentAppSocket, browser } = await serveShop();

  for (const [url, origin] of [
    [socketOf(address, { code: codeIn(address) }), new URL(address).origin],
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
