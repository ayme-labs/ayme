import {
  expect,
  test as base,
  selectors,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { recordPublishedTools } from "@ayme-dev/webmcp/testing";
import { pairedAgents } from "./agentView";
import { freePort, startAgent, type Agent } from "@ayme-dev/mcp/testing";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import { ListPage } from "../pom/ListPage";

export { expect } from "@playwright/test";

/**
 * Playwright draws the Inspector's highlights in an overlay under `<html>`
 * whose shadow root is closed. Opens it, before the page's scripts run, so
 * `highlightOf` can read the boxes.
 */
const openHighlightOverlay = () => {
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return attachShadow.call(
      this,
      this.localName === "x-pw-glass" ? { ...init, mode: "open" } : init
    );
  };
};

/**
 * The highlight Playwright draws over `element` now: its outline style
 * ("dashed" for what is hovered, "solid" for the selection) and colour, or
 * none. The page's own elements carry no mark for it.
 */
export function highlightOf(element: Locator) {
  return () =>
    element.evaluate((target) => {
      const rect = target.getBoundingClientRect();
      const boxes = [...document.querySelectorAll("x-pw-glass")].flatMap(
        (glass) => [
          ...(glass.shadowRoot?.querySelectorAll("x-pw-highlight") ?? []),
        ]
      ) as HTMLElement[];
      const near = (a: number, b: number) => Math.abs(a - b) < 1;
      const box = boxes.find((candidate) => {
        const at = candidate.getBoundingClientRect();
        return (
          candidate.style.display === "block" &&
          near(at.x, rect.x) &&
          near(at.y, rect.y) &&
          near(at.width, rect.width) &&
          near(at.height, rect.height)
        );
      });
      return box
        ? { style: box.style.outlineStyle, color: box.style.outlineColor }
        : { style: "none", color: "" };
    });
}

/** How the page outlines `element`: "dashed" hovered, "solid" selected, else "none". */
export function outline(element: Locator) {
  const read = highlightOf(element);
  return async () => (await read()).style;
}

/** The Caller mark of a run made from the panel, as Runs shows it. */
export const INSPECTOR = { icon: "Run by you from the Inspector" } as const;

/**
 * A fixture page: the list app with its Page Object, the runtime and the
 * Inspector. "/models.html" has other Page Objects; "/unpublished.html" is
 * the list app with WebMCP publication off; "/late.html" mounts the Inspector
 * in demo mode after the runtime started; "/session.html" mounts it through
 * the session's `inspector` option, in demo mode with "?demo"; "/dogfood.html"
 * mounts it for dogfooding, with the Inspector's own Page Object registered.
 */
export type FixturePage =
  | "/"
  | "/react.html"
  | "/models.html"
  | "/unpublished.html"
  | "/late.html"
  | "/session.html"
  | "/session.html?demo"
  | "/dogfood.html";

/**
 * Where a project runs the Inspector: `inline`, mounted in the fixture page,
 * or `external`, in a window of its own that `ayme mcp` serves, which the
 * fixture page reaches over the Agent Connection.
 */
export type Placement = "inline" | "external";

/**
 * The external placement's end of the run: the Ayme MCP server the page
 * connects to, and the window it serves the Inspector in.
 */
export type ExternalInspector = { agent: Agent; context: BrowserContext };

/** An Ayme MCP server an inline fixture page is connected to as a coding agent. */
export type PairedAgent = { agent: Agent };

/**
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the page's script broke or the runtime never published its
 * tools. With `external`, the page is opened for the external placement and
 * connected to its server, and the Inspector is the window that server
 * serves: `inspector` drives that window, and `page` stays the app's.
 */
export async function openFixture(
  page: Page,
  path: FixturePage,
  {
    reload = false,
    external,
    paired,
  }: {
    reload?: boolean;
    external?: ExternalInspector;
    paired?: PairedAgent;
  } = {}
) {
  const connected = paired?.agent ?? external?.agent;
  if (connected) pairedAgents.set(page, connected);
  await page.addInitScript(openHighlightOverlay);
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  if (reload) await page.reload();
  else if (external)
    await page.goto(await connectLink(external.agent, path, "external"));
  else if (paired)
    await page.goto(await connectLink(paired.agent, path, "agent"));
  else await page.goto(path);

  const root = page.locator("html");
  try {
    await root.and(page.locator("[data-fixture]")).waitFor({ timeout: 10_000 });
  } catch {
    throw new Error(
      `The fixture page ${path} never ran its script. ${pageErrors.join("; ")}`
    );
  }
  if ((await root.getAttribute("data-fixture")) !== "ready")
    throw new Error(
      `The fixture page ${path} failed to start: ${await root.getAttribute("data-fixture-error")}`
    );

  // Without publication the runtime stays "disabled"; otherwise it publishes.
  // The first page of a cold CI container has reached "active" just after a
  // 10 s wait gave up, so the runtime gets longer than the script did.
  const runtimeState = path === "/unpublished.html" ? "disabled" : "active";
  try {
    await root
      .and(page.locator(`[data-runtime="${runtimeState}"]`))
      .waitFor({ timeout: 30_000 });
  } catch {
    throw new Error(
      `The Ayme runtime did not reach "${runtimeState}": ${await root.getAttribute("data-runtime")}, ${await root.getAttribute("data-runtime-message")}`
    );
  }

  if (paired) await waitForPageTools(paired.agent);

  page.off("pageerror", onPageError);
  return {
    inspector: new Inspector(
      external ? await openInspectorWindow(page, external) : page
    ),
    listPage: new ListPage(page),
  };
}

/** Waits until the server lists the page's tools, `page_objects` among them. */
async function waitForPageTools(agent: Agent) {
  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain("page_objects");
}

/**
 * The link that pairs the fixture page with `agent`, opened with the query
 * `flag`: `external` for the external placement, `agent` to turn the Agent
 * Connection on in an inline page.
 */
async function connectLink(agent: Agent, path: FixturePage, flag: string) {
  const url = new URL(path, baseURL());
  url.searchParams.set(flag, "");
  const { text, isError } = await agent.call("ayme_connect", {
    url: url.href,
  });
  if (isError) throw new Error(`ayme_connect failed: ${text}`);
  return text;
}

/** The address the fixture pages are served on, which the config picked. */
function baseURL() {
  return `http://127.0.0.1:${process.env.AYME_E2E_PORT_INSPECTOR}`;
}

/**
 * Opens the window `ayme_inspect` names, beside the fixture page. The
 * Inspector in it is already there for a page connected to the server.
 */
async function openInspectorWindow(
  page: Page,
  { agent, context }: ExternalInspector
) {
  const { text: url, isError } = await agent.call("ayme_inspect");
  if (isError) throw new Error(`ayme_inspect failed: ${url}`);
  const window = await context.newPage();
  await window.goto(url);
  // The fixture page stays the one the person looks at.
  await page.bringToFront();
  return window;
}

export const test = base.extend<
  {
    publishedTools: void;
    fixturePath: FixturePage;
    placement: Placement;
    /** Whether an inline fixture page is connected to an Ayme MCP server. */
    pairAgent: boolean;
    agent: Agent | undefined;
    opened: Awaited<ReturnType<typeof openFixture>>;
    inspector: Inspector;
    listPage: ListPage;
  },
  { inspectorSelectors: void }
>({
  // The mounted Inspector lives in a closed shadow root; this engine is how
  // the page objects reach it on Playwright. Registered before any page.
  inspectorSelectors: [
    // Playwright reads a fixture's dependencies from this pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await registerInspectorSelectors(selectors);
      await use();
    },
    { scope: "worker", auto: true },
  ],
  // The runtime publishes to the recording WebMCP driver from
  // `@ayme-dev/webmcp/testing`, which the tests call tools through.
  publishedTools: [
    async ({ context }, use) => {
      await recordPublishedTools(context);
      await use();
    },
    { auto: true },
  ],
  fixturePath: ["/", { option: true }],
  placement: ["inline", { option: true }],
  pairAgent: [true, { option: true }],
  // The external placement's server: the Ayme MCP server the fixture page
  // connects to and that serves the Inspector. On a port of its own, outside
  // the range pages scan, so no other test's page pairs with it.
  agent: async ({ placement, pairAgent }, use) => {
    if (placement !== "external" && !pairAgent) return use(undefined);
    const agent = await startAgent(
      "--port",
      String(await freePort()),
      "--browser-tools"
    );
    await use(agent);
    await agent.close();
  },
  opened: async ({ page, context, fixturePath, agent, placement }, use) => {
    await use(
      await openFixture(page, fixturePath, {
        external:
          placement === "external" ? agent && { agent, context } : undefined,
        paired: placement === "inline" ? agent && { agent } : undefined,
      })
    );
  },
  inspector: async ({ opened }, use) => {
    await use(opened.inspector);
  },
  listPage: async ({ opened }, use) => {
    await use(opened.listPage);
  },
});
