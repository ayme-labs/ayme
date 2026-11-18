import { test as base, type Browser, type WebApp } from "@e2e-dev/web";
import { expect, type Screen } from "e2e";
import { freePort, startAgent, type Agent } from "@ayme-dev/mcp/testing";
import { recordPublishedTools } from "@ayme-dev/e2e-testing";

import type { FixturePage, Placement } from "../fixtures";
import { Inspector } from "./pom/Inspector";
import { ListPage } from "./pom/ListPage";
import { Tab, type On } from "./tab";

// The e2e (e2e.com) counterpart of `../fixtures.ts`. e2e hands a test no
// Playwright `Page`, so what that file does through one is done in the page,
// by init scripts and `browser.evaluate`, and the external placement's
// Inspector window is a second tab.

export type { FixturePage, Placement };

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

/** An attribute of the fixture page's `<html>`, read now. */
const rootAttribute = (browser: Browser, name: string) =>
  browser.evaluate(
    (name: string) => document.documentElement.getAttribute(name),
    name
  );

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the page's script broke or the runtime never published its
 * tools. In the external placement the page opens connected to `agent`, the
 * Ayme MCP server that serves the Inspector, and the Inspector is a second
 * tab with that window; the fixture page's tab stays in front.
 */
export async function openFixture(
  { app, browser, screen }: Fixtures,
  path: FixturePage,
  agent?: Agent
) {
  await browser.addInitScript(openHighlightOverlay);
  await recordPublishedTools(browser);
  if (agent) await browser.goto(await connectLink(agent, app, path));
  else await app.open(path);
  const [pageTab] = browser.tabs();

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

  // Without publication the runtime stays "disabled"; otherwise it publishes.
  const runtimeState = path === "/unpublished.html" ? "disabled" : "active";
  await expect
    .poll(() => rootAttribute(browser, "data-runtime"), {
      timeout: 30_000,
      message: `The Ayme runtime did not reach "${runtimeState}".`,
    })
    .toBe(runtimeState);

  const page = new Tab(screen, browser, pageTab!);
  return {
    inspector: new Inspector(
      agent ? await openInspectorTab({ browser, screen }, agent, page) : page
    ),
    listPage: new ListPage(page),
  };
}

/** The link that pairs the fixture page, opened for the external placement, with `agent`. */
async function connectLink(agent: Agent, app: WebApp, path: FixturePage) {
  const url = new URL(path, app.baseUrl);
  url.searchParams.set("external", "");
  const { text, isError } = await agent.call("ayme_connect", {
    url: url.href,
  });
  if (isError) throw new Error(`ayme_connect failed: ${text}`);
  return text;
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
 * `inspector` drives the Inspector, `listPage` reads the page. In the
 * external placement it also starts the Ayme MCP server the page connects
 * to, on a port of its own outside the range pages scan, so no other test's
 * page pairs with it.
 */
export function testIn(placement: Placement, path: FixturePage = "/") {
  return (
    base
      // Not `agent`: e2e reserves that name for its own agent.
      .extend<{ mcpServer: Agent | undefined }>({
        // A fixture with no dependencies.
        // eslint-disable-next-line no-empty-pattern
        mcpServer: async ({}, use) => {
          if (placement !== "external") return use(undefined);
          const agent = await startAgent("--port", String(await freePort()));
          await use(agent);
          await agent.close();
        },
      })
      .extend<{ opened: Awaited<ReturnType<typeof openFixture>> }>({
        opened: async ({ mcpServer, app, browser, screen }, use) => {
          await use(
            await openFixture({ app, browser, screen }, path, mcpServer)
          );
        },
      })
      .extend<{ inspector: Inspector; listPage: ListPage }>({
        inspector: async ({ opened }, use) => use(opened.inspector),
        listPage: async ({ opened }, use) => use(opened.listPage),
      })
  );
}

/**
 * How the page outlines `element` now: "dashed" hovered, "solid" selected,
 * else "none". Reads the highlight Playwright draws over the element's box;
 * the page's own elements carry no mark for it.
 */
export function outline(element: On, browser: Browser) {
  return async () => {
    const box = await (await element.front()).boundingBox();
    if (!box) return "none";
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
      return hit ? hit.style.outlineStyle : "none";
    }, box);
  };
}
