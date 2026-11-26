import { test as base, type Browser, type WebApp } from "@e2e-dev/web";
import { expect, type Screen } from "e2e";
import { freePort, startAgent, type Agent } from "@ayme-dev/mcp/testing";
import { e2e as webmcp } from "@ayme-dev/webmcp/testing";

import type { FixturePage, Placement } from "../fixtures";
import { AppView } from "./appView";
import { Inspector } from "./pom/Inspector";
import { ListPage } from "./pom/ListPage";
import { Tab, type On } from "./tab";

// The e2e (e2e.com) counterpart of `../fixtures.ts`. e2e hands a test no
// Playwright `Page`, so what that file does through one is done in the page,
// by init scripts and `browser.evaluate`, and the external placement's
// Inspector window is a second tab.

export type { FixturePage, Placement };

/** The Caller mark of a run made from the panel, as Runs shows it. */
export const INSPECTOR = { icon: "Run by you from the Inspector" } as const;

/** Both placements, for a spec whose tests run in each. */
export const placements: readonly Placement[] = ["inline", "external"];

/**
 * In the page: Playwright draws the Inspector's highlights in an overlay
 * under `<html>` whose shadow root is closed. Opens it, before the page's
 * scripts run, so `outline` can read the boxes.
 */
function openHighlightOverlay() {
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return attachShadow.call(
      this,
      this.localName === "x-pw-glass" ? { ...init, mode: "open" } : init
    );
  };
}

type Fixtures = { app: WebApp; browser: Browser; screen: Screen };

/**
 * The browsers whose documents get the fixture's init script already: a test
 * that opens a second fixture page must not install it twice.
 */
const prepared = new WeakSet<Browser>();

/**
 * The browsers whose documents get the recording WebMCP driver: its
 * `document.modelContext` can be defined only once.
 */
const recording = new WeakSet<Browser>();

/** An attribute of the fixture page's `<html>`, read now. */
const rootAttribute = (browser: Browser, name: string) =>
  browser.evaluate(
    (name: string) => document.documentElement.getAttribute(name),
    name
  );

/**
 * Waits until the fixture page in the active tab ran its script and the
 * runtime listed its tools, failing with its own message, before any test
 * assertion, when either never happens.
 */
async function fixtureReady(browser: Browser, path: FixturePage) {
  await expect
    .poll(() => rootAttribute(browser, "data-fixture"), {
      timeout: 10_000,
      message: `The fixture page ${path} never ran its script.`,
    })
    .not.toBe(null);
  const fixture = await rootAttribute(browser, "data-fixture");
  if (fixture !== "ready")
    throw new Error(
      `The fixture page ${path} failed to start: ${await rootAttribute(browser, "data-fixture-error")}`
    );

  // The first page of a cold CI container has listed its tools just after a
  // 10 s wait gave up, so the runtime gets longer than the script did.
  await expect
    .poll(
      () =>
        browser.evaluate(() => window.fixtureAyme?.tools.list().length ?? 0),
      {
        timeout: 30_000,
        message: `The ayme runtime of ${path} never listed its tools.`,
      }
    )
    .toBeGreaterThan(0);
}

/** Reloads the fixture page and waits for it as `openFixture` does. */
export async function reloadFixture(page: Tab, path: FixturePage) {
  await page.front();
  await page.browser.reload();
  await fixtureReady(page.browser, path);
}

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the page's script broke or the runtime never listed its
 * tools. With `agent`, the page is opened through that agent's connect link
 * and waits until the agent lists its tools. With `external` as well, the
 * page is opened for the external placement, and the Inspector is a second
 * tab with the window the agent's server serves; the fixture page's tab stays
 * in front. With `webMCP`, the page publishes to the recording WebMCP
 * driver, standing in for the browser's.
 */
export async function openFixture(
  { app, browser, screen }: Fixtures,
  path: FixturePage,
  {
    agent,
    external = false,
    webMCP = false,
  }: { agent?: Agent; external?: boolean; webMCP?: boolean } = {}
) {
  if (!prepared.has(browser)) {
    prepared.add(browser);
    await browser.addInitScript(openHighlightOverlay);
  }
  if (webMCP && !recording.has(browser)) {
    recording.add(browser);
    await webmcp.recordPublishedTools(browser);
  }
  if (agent) await browser.goto(await connectLink(agent, app, path, external));
  else await app.open(path);
  // The tab the page opened in: a test may have an Inspector tab in front.
  const pageTab = browser.tabs().find((tab) => tab.isActive());
  if (!pageTab) throw new Error(`No tab is active after opening ${path}.`);
  await fixtureReady(browser, path);
  if (agent)
    await expect.poll(() => agent.toolNames()).toContain("page_objects");

  const page = new Tab(screen, browser, pageTab);
  return {
    page,
    inspector: new Inspector(
      agent && external
        ? await openInspectorTab({ browser, screen }, agent, page)
        : page
    ),
    listPage: new ListPage(page),
  };
}

/**
 * The link that pairs the fixture page with `agent`, opened for the external
 * placement or, with the Agent Connection on, for the inline one.
 */
async function connectLink(
  agent: Agent,
  app: WebApp,
  path: FixturePage,
  external: boolean
) {
  const url = new URL(path, app.baseUrl);
  url.searchParams.set(external ? "external" : "agent", "");
  const { text, isError } = await agent.call("ayme_connect", {
    url: url.href,
  });
  if (isError) throw new Error(`ayme_connect failed: ${text}`);
  // The link is the answer's first line; a note may follow it.
  return text.split("\n")[0]!;
}

/**
 * What a Page Object Tool's call over `agent` answers: its JSON, or its
 * error text with `isError`.
 */
export async function callOverMcp(
  agent: Agent,
  name: string,
  input: Record<string, unknown> = {}
) {
  const { text, isError } = await agent.call(name, input);
  return isError
    ? { isError, text }
    : (JSON.parse(text) as Record<string, unknown>);
}

/**
 * Opens the window `ayme_inspect` names in a tab of its own. The Inspector in
 * it is already there for a page connected to the server.
 */
async function openInspectorTab(
  { browser, screen }: Omit<Fixtures, "app">,
  agent: Agent,
  page: Tab
) {
  const { text: url, isError } = await agent.call("ayme_inspect");
  if (isError) throw new Error(`ayme_inspect failed: ${url}`);
  const tab = await browser.newTab();
  await browser.goto(url);
  // The fixture page stays the one the person looks at.
  await page.front();
  return new Tab(screen, browser, tab);
}

/**
 * e2e's `test` for one placement, with the fixture page at `path` open:
 * `inspector` drives the Inspector, `listPage` reads the page, `appView`
 * reads and runs the page's runtime. In the external placement, or with
 * `connected`, it also starts the agent's ayme MCP server, `mcpServer`, which
 * the page connects to and, in the external placement, serves the Inspector.
 * On a port of its own, outside the range pages scan, so no other test's page
 * pairs with it.
 */
export function testIn(
  placement: Placement,
  path: FixturePage = "/",
  {
    connected = false,
  }: {
    /**
     * Whether the inline placement's page is connected to an agent, which
     * the tests then call its Page Object Tools through, as a coding agent
     * does.
     */
    connected?: boolean;
  } = {}
) {
  return (
    base
      // Not `agent`: e2e reserves that name for its own agent.
      .extend<{ mcpServer: Agent | undefined }>({
        // A fixture with no dependencies.
        // eslint-disable-next-line no-empty-pattern
        mcpServer: async ({}, use) => {
          if (placement !== "external" && !connected) return use(undefined);
          const agent = await startAgent("--port", String(await freePort()));
          await use(agent);
          await agent.close();
        },
      })
      .extend<{ opened: Awaited<ReturnType<typeof openFixture>> }>({
        opened: async ({ mcpServer, app, browser, screen }, use) => {
          await use(
            await openFixture({ app, browser, screen }, path, {
              agent: mcpServer,
              external: placement === "external",
            })
          );
        },
      })
      .extend<{
        inspector: Inspector;
        listPage: ListPage;
        appView: AppView;
        page: Tab;
      }>({
        inspector: async ({ opened }, use) => use(opened.inspector),
        listPage: async ({ opened }, use) => use(opened.listPage),
        appView: async ({ opened }, use) => use(new AppView(opened.page)),
        // The fixture page's tab, for a test that reads the page directly.
        page: async ({ opened }, use) => use(opened.page),
      })
  );
}

/**
 * The highlight Playwright draws over `element` now: its outline style
 * ("dashed" for what is hovered, "solid" for the selection) and colour, or
 * none. The page's own elements carry no mark for it.
 */
export function highlightOf(element: On, browser: Browser) {
  return async () => {
    const box = await (await element.front()).boundingBox();
    if (!box) return { style: "none", color: "" };
    return browser.evaluate((rect) => {
      const boxes = [...document.querySelectorAll("x-pw-glass")].flatMap(
        (glass) => [
          ...(glass.shadowRoot?.querySelectorAll("x-pw-highlight") ?? []),
        ]
      ) as HTMLElement[];
      const near = (a: number, b: number) => Math.abs(a - b) < 1;
      const hit = boxes.find((candidate) => {
        const at = candidate.getBoundingClientRect();
        return (
          candidate.style.display === "block" &&
          near(at.x, rect.x) &&
          near(at.y, rect.y) &&
          near(at.width, rect.width) &&
          near(at.height, rect.height)
        );
      });
      return hit
        ? { style: hit.style.outlineStyle, color: hit.style.outlineColor }
        : { style: "none", color: "" };
    }, box);
  };
}

/** How the page outlines `element`: "dashed" hovered, "solid" selected, else "none". */
export function outline(element: On, browser: Browser) {
  const read = highlightOf(element, browser);
  return async () => (await read()).style;
}
