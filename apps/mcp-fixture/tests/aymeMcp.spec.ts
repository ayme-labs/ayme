import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { aymeCommand, runAyme } from "@ayme-dev/cli/testing";
import {
  Inspector,
  INSPECTOR_SELECTOR_ENGINE,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium, selectors, type Browser, type Page } from "@playwright/test";

import { expect, test as base } from "./aymeCommand";

// `ayme mcp` of `@ayme-dev/cli`, started as an Agent App starts it, as a
// child process the test talks to through an MCP SDK client over stdio. It
// has one job: it shows the Inspector of a Session in the Agent App's chat.
// These tests stand in for an Agent App that shows MCP Apps: they read the
// page the tool points to over MCP, as the Agent App does, and show it in a
// frame sandboxed without `allow-same-origin`, under the Content Security
// Policy the page declares, through the ext-apps SDK's own host side
// (`app/agentApp.ts`). The test's own Playwright connection to the
// Session's browser plays the developer's browser automation. The
// Inspector renders into a closed shadow root; its page objects reach it
// through these selectors.

/** The MCP revisions an Agent App may open with. */
const REVISIONS = ["2025-11-25", "2026-07-28"] as const;

/** The one tool `ayme mcp` offers. */
const INSPECT = "ayme_inspect";

type Mcp = Awaited<ReturnType<typeof startMcp>>;

/** Starts `ayme mcp` with `args` in `cwd`, with `env`, and opens an MCP
 * conversation with it under `revision`. */
async function startMcp(
  args: readonly string[],
  {
    cwd,
    env,
    revision = "2025-11-25",
  }: {
    cwd: string;
    env: Record<string, string>;
    revision?: (typeof REVISIONS)[number];
  }
) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [aymeCommand, "mcp", ...args],
    cwd,
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  const client = new Client(
    { name: "ayme-e2e", version: "0.0.0" },
    revision === "2026-07-28"
      ? { versionNegotiation: { mode: { pin: revision } } }
      : undefined
  );
  await client.connect(transport);
  return {
    client,
    stderr: () => stderr,
    /** Calls `ayme_inspect`, and resolves with its text. */
    async inspect() {
      const result = await client.callTool({ name: INSPECT, arguments: {} });
      const [first] = result.content as { type: string; text?: string }[];
      return { text: first?.text ?? "", isError: result.isError === true };
    },
    /** The page `ayme_inspect` points an Agent App to, as the Agent App
     * reads it. */
    async page() {
      const { tools } = await client.listTools();
      const uri = (
        tools.find((tool) => tool.name === INSPECT)?._meta?.ui as
          { resourceUri?: string } | undefined
      )?.resourceUri;
      expect(uri).toMatch(/^ui:\/\//);
      const { contents } = await client.readResource({ uri: uri! });
      const [page] = contents;
      expect(page).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      const csp = (page!._meta?.ui as { csp?: { connectDomains?: string[] } })
        ?.csp;
      return {
        html: (page as { text: string }).text,
        connectDomains: csp?.connectDomains ?? [],
      };
    },
    close: () => client.close(),
  };
}

const test = base.extend<{
  /** Starts `ayme mcp` in the project, as the Session's commands run, with
   * `env` added to theirs; it ends with the test. */
  mcp: (
    args?: readonly string[],
    options?: {
      env?: Record<string, string>;
      revision?: (typeof REVISIONS)[number];
    }
  ) => Promise<Mcp>;
  /** The Session's commands' environment, which `ayme inspect` and
   * `ayme mcp` get too. */
  commandEnv: Record<string, string>;
}>({
  commandEnv: async ({ temporary }, use, testInfo) => {
    await use({
      ...(process.env as Record<string, string>),
      AYME_CACHE_DIR: testInfo.outputPath("cache"),
      TMPDIR: temporary,
    });
  },
  mcp: async ({ project, commandEnv }, use) => {
    const started: Mcp[] = [];
    await use(async (args = [], { env = {}, revision } = {}) => {
      const mcp = await startMcp(args, {
        cwd: project,
        env: { ...commandEnv, ...env },
        revision,
      });
      started.push(mcp);
      return mcp;
    });
    await Promise.all(started.map((mcp) => mcp.close()));
  },
});

test.beforeAll(() => registerInspectorSelectors(selectors));

const cleanups: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

/** The browser automation's first Tab, connected to the Session's browser
 * that `ayme open` printed the address of. */
async function automatedTab(opened: string): Promise<Page> {
  const browser = await chromium.connectOverCDP(addressIn(opened)!);
  cleanups.push(() => browser.close());
  return browser.contexts()[0]!.pages()[0]!;
}

/**
 * Shows `app` in a stand-in Agent App, in a browser context of its own,
 * under the policy T3 Code was measured to apply, the strictest of the
 * Agent Apps measured: inline scripts and styles only, and connections only
 * to the origins the page declares. From a loopback server of its own: a
 * document Playwright fulfils has no address, so Chrome would take it for a
 * public one and block its connection to the loopback server.
 */
async function showInAgentApp(
  browser: Browser,
  baseURL: string,
  app: { html: string; connectDomains: string[] }
) {
  const frameServer = createServer((_, response) =>
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": [
          "default-src 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
          "img-src data: blob:",
          "font-src data:",
          "media-src data: blob:",
          `connect-src ${app.connectDomains.join(" ") || "'none'"}`,
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join("; "),
      })
      .end(app.html)
  );
  await new Promise<void>((resolve) =>
    frameServer.listen(0, "127.0.0.1", resolve)
  );
  const { port } = frameServer.address() as AddressInfo;
  const context = await browser.newContext();
  cleanups.push(async () => {
    await context.close();
    await closeServer(frameServer);
  });
  const page = await context.newPage();
  await page.goto(
    `${baseURL}/agent-app.html?modes=inline&announce=1&resize=1&frame=${encodeURIComponent(`http://127.0.0.1:${port}/`)}`
  );
  const frame = page.frameLocator("#app");
  const inspector = new Inspector(
    page,
    frame.locator(`${INSPECTOR_SELECTOR_ENGINE}=[data-ayme-inspector-root]`)
  );
  return { frame, inspector };
}

function closeServer(server: Server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

/** The text of every Session log under `folder`. */
function sessionLogs(folder: string): string {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith("session.log"))
    .map((path) => readFileSync(join(folder, path), "utf8"))
    .join("\n");
}

for (const revision of REVISIONS)
  test(`under MCP revision ${revision}, ayme mcp lists one tool, which shows the Inspector and reads or acts on nothing on the page, with no Session open yet`, async ({
    mcp,
  }) => {
    const { client } = await mcp([], { revision });

    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual([INSPECT]);
    expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true });
    const { resources } = await client.listResources();
    expect(resources.map(({ uri }) => uri)).toEqual([
      "ui://ayme/inspector.html",
    ]);
  });

test("an Agent App shows the Inspector of the Session -s names, which runs a Page Object Tool on the Session's Tab as a Run of the Inspector", async ({
  ayme,
  mcp,
  baseURL,
  browser,
}) => {
  const shop = await automatedTab(
    (await ayme("open", "-s=shop", `${baseURL}/shop.html`)).stdout
  );
  const agentApp = await mcp(["-s=shop"]);

  expect(await agentApp.inspect()).toEqual({
    text: "The Inspector of the Session shop shows in this chat when your Agent App shows MCP Apps. ayme -s=shop inspect opens it in a browser window.",
    isError: false,
  });
  const { inspector } = await showInAgentApp(
    browser,
    baseURL!,
    await agentApp.page()
  );
  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toEqual(expect.arrayContaining(["ShopPage", "Basket"]));
  await (await inspector.tool("Basket.add")).run({ item: "Milk" });

  const run = inspector.runs.latest("Basket.add");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual({ icon: "Run by you from the Inspector" });
  await expect(shop.getByRole("listitem")).toHaveText(["Milk"]);
  // No agent reaches a Session through the Agent Connection or WebMCP.
  await expect(inspector.header.connections.root).toHaveCount(0);
});

test("AYME_SESSION names the Session, as for every other command", async ({
  ayme,
  mcp,
  baseURL,
}) => {
  await ayme("open", "-s=cart", `${baseURL}/shop.html`);

  const agentApp = await mcp([], { env: { AYME_SESSION: "cart" } });

  expect(await agentApp.inspect()).toMatchObject({
    text: expect.stringContaining("The Inspector of the Session cart"),
    isError: false,
  });
});

test("with no Session open, the tool says how to start one, and the page an Agent App shows says so and connects nowhere", async ({
  mcp,
  project,
}) => {
  const agentApp = await mcp();

  const inspected = await agentApp.inspect();
  const { html, connectDomains } = await agentApp.page();

  const why = `No Session is open in ${project}. Start one with ayme -s=default open.`;
  expect(inspected).toEqual({ text: why, isError: true });
  expect(html).toContain(
    `${why} Then ask your agent to show the Inspector again.`
  );
  expect(connectDomains).toEqual([]);
});

test("once the Session ends, the Inspector in the chat says so and connects no more", async ({
  ayme,
  mcp,
  baseURL,
  browser,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const agentApp = await mcp();
  const { frame, inspector } = await showInAgentApp(
    browser,
    baseURL!,
    await agentApp.page()
  );
  await expect
    .poll(() => inspector.navigator.model.objectPaths())
    .toContain("Basket");

  await ayme("close");

  await expect(frame.getByRole("status")).toHaveText(
    "The Session default was closed. Start a Session with ayme open or ayme attach, then run ayme -s=default inspect to inspect it."
  );
  await expect(inspector.panel).toHaveCount(0);
});

test("the window ayme inspect opens is admitted by a one-use code and connects again after a reload, the view in the chat by the Session's token, which neither the command's output nor the window's address nor the Session's log holds", async ({
  ayme,
  mcp,
  baseURL,
  browser,
  commandEnv,
  project,
  temporary,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const inspected = await runAyme(["inspect"], {
    cwd: project,
    env: { ...commandEnv, BROWSER: "none" },
  });
  const address = /at (http:\/\/\S+#code=[\w-]+)\./.exec(inspected.stdout)?.[1];
  const code = new URLSearchParams(new URL(address!).hash.slice(1)).get("code");
  expect(code, inspected.stdout).toMatch(/^[\w-]{32}$/);

  const window = await browser.newPage();
  cleanups.push(() => window.close());
  await window.goto(address!);
  const inWindow = new Inspector(window);
  await inWindow.open();
  await expect
    .poll(() => inWindow.navigator.model.objectPaths())
    .toContain("Basket");
  await window.reload();
  await inWindow.open();
  await expect
    .poll(() => inWindow.navigator.model.objectPaths())
    .toContain("Basket");
  const page = await (await mcp()).page();
  const { inspector: inChat } = await showInAgentApp(browser, baseURL!, page);
  await expect
    .poll(() => inChat.navigator.model.objectPaths())
    .toContain("Basket");

  const token = /token=([\w-]{32})/.exec(page.html)?.[1];
  expect(token).toBeDefined();
  expect(`${inspected.stdout}${inspected.stderr}`).not.toContain(token);
  expect(window.url()).toBe(address!.split("#")[0]);
  await expect(inWindow.header.connections.root).toHaveCount(0);
  expect(sessionLogs(temporary)).not.toContain(token);
  expect(sessionLogs(temporary)).not.toContain(code);
});
