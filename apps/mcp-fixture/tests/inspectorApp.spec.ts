import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { selectors, type Browser, type Page } from "@playwright/test";
import {
  Inspector,
  INSPECTOR_SELECTOR_ENGINE,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import {
  type Agent,
  connectPage,
  expect,
  startServingAgent,
  test,
} from "./fixtures";

// `ayme_inspect` carries the external Inspector as an MCP App. These tests
// stand in for an agent app that shows MCP Apps: they read the page the
// tool points to over MCP, as the agent app does, and show it in a frame
// sandboxed without `allow-same-origin`, under the Content Security Policy
// the page declares, through the ext-apps SDK's own host side
// (`app/agentApp.ts`). The Inspector renders into a closed shadow root; its
// page objects reach it through these selectors.
test.beforeAll(() => registerInspectorSelectors(selectors));

/** The Page Object Tool of the served entry's `PlainPage`. */
const PLAIN_PAGE_TOOL = "PlainPage.readNote";

/** The page `ayme_inspect` points an agent app to, as the agent app reads it. */
async function inspectorApp(agent: Agent) {
  const { tools } = await agent.client.listTools();
  const inspect = tools.find((tool) => tool.name === "ayme_inspect");
  const uri = (inspect?._meta?.ui as { resourceUri?: string } | undefined)
    ?.resourceUri;
  expect(uri, JSON.stringify(inspect)).toMatch(/^ui:\/\//);
  const { contents } = await agent.client.readResource({ uri: uri! });
  const [page] = contents;
  expect(page).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
  const csp = (page!._meta?.ui as { csp?: { connectDomains?: string[] } })?.csp;
  return {
    html: (page as { text: string }).text,
    connectDomains: csp?.connectDomains ?? [],
  };
}

/**
 * Shows the page in a stand-in agent app that offers `modes`, in a browser
 * context of its own. Returns the agent app's page, the Inspector in it, and
 * `close`, which closes both. Without `announces`, the agent app grants a
 * display mode in its answer only and sends no context change after it.
 */
async function showInAgentApp(
  browser: Browser,
  baseURL: string,
  app: { html: string; connectDomains: string[] },
  modes: string[],
  announces = true
) {
  // Under the policy T3 Code was measured to apply, the strictest of the
  // agent apps measured: inline scripts and styles only, and connections
  // only to the origins the page declares. From a loopback server of its
  // own: a document Playwright fulfils has no address, so Chrome would take
  // it for a public one and block its connection to the loopback server.
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
  const page = await context.newPage();
  await page.goto(
    `${baseURL}/agent-app.html?modes=${modes.join(",")}&announce=${announces ? 1 : 0}&frame=${encodeURIComponent(`http://127.0.0.1:${port}/`)}`
  );
  const inspector = new Inspector(
    page,
    page
      .frameLocator("#app")
      .locator(`${INSPECTOR_SELECTOR_ENGINE}=[data-ayme-inspector-root]`)
  );
  const close = async () => {
    await context.close();
    await closeServer(frameServer);
  };
  return { page, inspector, close };
}

function closeServer(server: Server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

/** What the page asked the stand-in agent app for. */
function agentAppSaw(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          agentAppSaw: { heights: number[]; displayModes: string[] };
        }
      ).agentAppSaw
  );
}

test("an agent app shows the Inspector ayme_inspect points to, which runs a tool on the paired page, admitted by its token", async ({
  context,
  page,
  browser,
  baseURL,
}, testInfo) => {
  const { agent } = await startServingAgent(context, testInfo);
  try {
    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);

    const { text: url, isError } = await agent.call("ayme_inspect");
    expect(isError, url).toBe(false);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/inspector$/);
    const app = await inspectorApp(agent);
    const shown = await showInAgentApp(browser, baseURL!, app, [
      "inline",
      "fullscreen",
    ]);
    try {
      await (await shown.inspector.tool(PLAIN_PAGE_TOOL)).run();

      const run = shown.inspector.runs.latest(PLAIN_PAGE_TOOL);
      await expect.poll(() => run.status()).toBe("Succeeded");
      expect(await run.resultText()).toContain("does not run Ayme");
      expect(agent.log).toContain(
        "An Inspector window was admitted by its token (origin null)."
      );
      expect((await agentAppSaw(shown.page)).heights).toEqual([600]);

      await shown.inspector.header.toggleFullscreen();

      await expect
        .poll(async () => (await agentAppSaw(shown.page)).displayModes)
        .toEqual(["fullscreen"]);
      await expect(
        shown.inspector.header.fullscreenButton
      ).toHaveAccessibleName("Exit fullscreen");
    } finally {
      await shown.close();
    }
  } finally {
    await agent.close();
  }
});

test("the Inspector in an agent app that offers no fullscreen has no fullscreen control", async ({
  context,
  page,
  browser,
  baseURL,
}, testInfo) => {
  const { agent } = await startServingAgent(context, testInfo);
  try {
    await connectPage(agent, page, `${baseURL}/plain.html`);
    const shown = await showInAgentApp(
      browser,
      baseURL!,
      await inspectorApp(agent),
      ["inline"]
    );
    try {
      await shown.inspector.open();
      // The page asks for its height once the agent app has answered.
      await expect
        .poll(async () => (await agentAppSaw(shown.page)).heights)
        .toEqual([600]);

      await expect(shown.inspector.header.title).toBeVisible();
      await expect(shown.inspector.header.fullscreenButton).toHaveCount(0);
    } finally {
      await shown.close();
    }
  } finally {
    await agent.close();
  }
});

test("the Inspector goes by the display mode an agent app grants, when the agent app announces no change after it", async ({
  context,
  page,
  browser,
  baseURL,
}, testInfo) => {
  const { agent } = await startServingAgent(context, testInfo);
  try {
    await connectPage(agent, page, `${baseURL}/plain.html`);
    const shown = await showInAgentApp(
      browser,
      baseURL!,
      await inspectorApp(agent),
      ["inline", "fullscreen"],
      false
    );
    try {
      await shown.inspector.open();
      const { header } = shown.inspector;

      await header.toggleFullscreen();
      await expect(header.fullscreenButton).toHaveAccessibleName(
        "Exit fullscreen"
      );
      await header.toggleFullscreen();

      await expect(header.fullscreenButton).toHaveAccessibleName("Fullscreen");
      expect((await agentAppSaw(shown.page)).displayModes).toEqual([
        "fullscreen",
        "inline",
      ]);
    } finally {
      await shown.close();
    }
  } finally {
    await agent.close();
  }
});

test("the Inspector in an agent app stops and says so once its server is gone", async ({
  context,
  page,
  browser,
  baseURL,
}, testInfo) => {
  const { agent } = await startServingAgent(context, testInfo);
  try {
    await connectPage(agent, page, `${baseURL}/plain.html`);
    const shown = await showInAgentApp(
      browser,
      baseURL!,
      await inspectorApp(agent),
      ["inline"]
    );
    try {
      await shown.inspector.open();
      await expect(shown.inspector.header.title).toBeVisible();

      await agent.close();

      // It connects again a few times, a second apart, before it stops.
      await expect(
        shown.page
          .frameLocator("#app")
          .getByText("This Inspector lost its Ayme MCP server.")
      ).toBeVisible({ timeout: 15_000 });
      await expect(shown.inspector.header.title).toHaveCount(0);
    } finally {
      await shown.close();
    }
  } finally {
    await agent.close();
  }
});
