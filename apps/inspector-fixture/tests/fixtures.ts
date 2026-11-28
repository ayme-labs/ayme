import {
  expect,
  test as base,
  selectors,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { freePort, startAgent, type Agent } from "@ayme-dev/mcp/testing";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import { ListPage } from "#pom/ListPage";

export { expect } from "@playwright/test";

/**
 * Playwright draws the Inspector's highlights in an overlay under `<html>`
 * whose shadow root is closed. Opens it, before the page's scripts run, so
 * `outline` can read the boxes.
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
 * How the page outlines `element` now, by the highlight Playwright draws over
 * it: "dashed" hovered, "solid" selected, else "none". The page's own
 * elements carry no mark for it.
 */
export function outline(element: Locator) {
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
      return box ? box.style.outlineStyle : "none";
    });
}

/**
 * Waits until the panel's first look at the page has landed, so every test
 * starts after it: a step that runs while it lands sees the panel change under
 * it (the legend wraps onto a second line, which moves the Model lens's rows
 * down under the pointer), and a goal recorded then does not replay once the
 * look lands first. The legend's refs count is the only sign of the look the
 * panel's first view shows; when the legend goes, wait for what replaces it.
 */
async function settledStart(inspector: Inspector) {
  await expect(inspector.navigator.legend).toContainText(/(^|\D)[1-9]\d* refs/);
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
 * Opens a fixture page and fails with its own message, before any test
 * assertion, when the page's script broke or the runtime never listed its
 * tools. With `agent`, the page is opened through that agent's connect link
 * and waits until the agent lists its tools. With `external` as well, the
 * page is opened for the external placement, and the Inspector is the window
 * the agent's server serves, opened in that context: `inspector` drives that
 * window, and `page` stays the app's. Either way the test starts as
 * `settledStart` says.
 */
export async function openFixture(
  page: Page,
  path: FixturePage,
  {
    reload = false,
    agent,
    external,
  }: { reload?: boolean; agent?: Agent; external?: BrowserContext } = {}
) {
  await page.addInitScript(openHighlightOverlay);
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  if (reload) await page.reload();
  else if (agent)
    await page.goto(await connectLink(agent, path, external !== undefined));
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

  // The first page of a cold CI container has listed its tools just after a
  // 10 s wait gave up, so the runtime gets longer than the script did.
  try {
    await page.waitForFunction(
      () => (window.fixtureAyme?.tools.list().length ?? 0) > 0,
      undefined,
      { timeout: 30_000 }
    );
  } catch {
    throw new Error(`The ayme runtime of ${path} never listed its tools.`);
  }
  if (agent)
    await expect.poll(() => agent.toolNames()).toContain("page_objects");

  page.off("pageerror", onPageError);
  const inspector = new Inspector(
    agent && external ? await openInspectorWindow(page, agent, external) : page
  );
  await settledStart(inspector);
  return { inspector, listPage: new ListPage(page) };
}

/**
 * The link that pairs the fixture page with `agent`, opened for the external
 * placement or, with the Agent Connection on, for the inline one.
 */
async function connectLink(agent: Agent, path: FixturePage, external: boolean) {
  const url = new URL(path, baseURL());
  url.searchParams.set(external ? "external" : "agent", "");
  const { text, isError } = await agent.call("ayme_connect", {
    url: url.href,
  });
  if (isError) throw new Error(`ayme_connect failed: ${text}`);
  // The link is the answer's first line; a note may follow it.
  return text.split("\n")[0]!;
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
  agent: Agent,
  context: BrowserContext
) {
  const { text: url, isError } = await agent.call("ayme_inspect");
  if (isError) throw new Error(`ayme_inspect failed: ${url}`);
  const window = await context.newPage();
  await window.goto(url);
  // The fixture page stays the one the person looks at.
  await page.bringToFront();
  return window;
}

/**
 * What a Page Object Tool's call over `agent` answers, as JSON. A call that
 * fails throws with its error text, so no check of the answer can pass on it.
 */
export async function callOverMcp(
  agent: Agent,
  name: string,
  input: Record<string, unknown> = {}
) {
  const { text, isError } = await agent.call(name, input);
  if (isError) throw new Error(`${name} failed over ayme MCP: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** An agent as `startAgent` starts it, with what stops its server. */
type StartedAgent = Awaited<ReturnType<typeof startAgent>>;

export const test = base.extend<
  {
    fixturePath: FixturePage;
    placement: Placement;
    connected: boolean;
    /** The agent's server, which a test may stop. */
    agent: StartedAgent | undefined;
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
  fixturePath: ["/", { option: true }],
  placement: ["inline", { option: true }],
  // Whether the inline placement's page is connected to an agent, which the
  // tests then call its Page Object Tools through, as a coding agent does.
  connected: [false, { option: true }],
  // The agent's ayme MCP server, which the fixture page connects to and, in
  // the external placement, serves the Inspector. On a port of its own,
  // outside the range pages scan, so no other test's page pairs with it.
  agent: async ({ placement, connected }, use) => {
    if (placement !== "external" && !connected) return use(undefined);
    const agent = await startAgent("--port", String(await freePort()));
    await use(agent);
    await agent.close();
  },
  opened: async ({ page, context, fixturePath, placement, agent }, use) => {
    await use(
      await openFixture(page, fixturePath, {
        agent,
        external: placement === "external" ? context : undefined,
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
