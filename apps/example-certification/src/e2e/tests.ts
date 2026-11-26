import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { test as base, type Browser, type WebApp } from "@e2e-dev/web";
import { expect, type Locator, type Screen } from "e2e";
import { freePort, startAgent, type Agent } from "@ayme-dev/mcp/testing";
import { e2e as webmcp, type RecordingDriver } from "@ayme-dev/webmcp/testing";

import { counterPath, server } from "./config";

const {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} = webmcp;

// The e2e (e2e.com) port of `../tests.ts`. e2e gives a test no Playwright
// `Page` or `BrowserContext`, so what the Playwright builders do through
// them is done here in the page, by init scripts and `browser.evaluate`.

/**
 * In the page: answers the Agent Connection's auto-pair scan as if no ayme
 * MCP server ran, so a page under test never pairs by itself with a server
 * another test or suite runs on this machine. The scan probes
 * `ws://127.0.0.1:<port>/probe` on each port from 9350 to 9365 and counts a
 * port only when the server closes the probe with its identity; a probe
 * closed while it connects reads as no server. The Playwright builders route
 * these WebSockets instead (`ignoreAutoPairScan`), which e2e cannot.
 */
function ignoreAutoPairScanInPage() {
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const target = new URL(url, location.href);
      const port = Number(target.port);
      if (
        target.hostname === "127.0.0.1" &&
        target.pathname === "/probe" &&
        port >= 9350 &&
        port <= 9365
      )
        this.close();
    }
  };
}

/** Where `recordPageErrors` keeps what it saw, across the tab's documents. */
const pageErrorsKey = "ayme-e2e:page-errors";

/**
 * In the page: keeps every uncaught exception, unhandled rejection, console
 * error and console message about hydration in the tab's sessionStorage,
 * which outlives a full page load. e2e reports no page events to a test, so
 * this stands in for Playwright's `pageerror` and `console` events. It sees
 * what the page's own code reports, not what the browser logs by itself,
 * such as a failed request.
 */
function recordPageErrors(key: string) {
  const record = (text: string) => {
    const errors = JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[];
    errors.push(text);
    sessionStorage.setItem(key, JSON.stringify(errors));
  };
  const format = (values: unknown[]) =>
    values
      .map((value) =>
        value instanceof Error
          ? value.message
          : typeof value === "string"
            ? value
            : String(value)
      )
      .join(" ");
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      const text = format(values);
      if (level === "error" || /hydrat/i.test(text)) record(text);
      original(...values);
    };
  }
  addEventListener("error", (event) => record(event.message));
  addEventListener("unhandledrejection", (event: PromiseRejectionEvent) =>
    record(format([event.reason]))
  );
}

/**
 * e2e's `test`, whose pages never pair by themselves with an ayme MCP server
 * that runs on this machine (`ignoreAutoPairScanInPage`). Every example spec
 * uses it, or `test`, which builds on it.
 */
export const exampleTest = base.extend<{ ignoreAutoPairScan: void }>({
  // Automatic: no test names it, and e2e sets up only the fixtures a test
  // names, or those marked `auto`.
  ignoreAutoPairScan: [
    async ({ browser }, use) => {
      await browser.addInitScript(ignoreAutoPairScanInPage);
      // The resource timing that `loadedScripts` reads keeps 250 entries by
      // default, fewer than a dev server can load.
      await browser.addInitScript(() =>
        performance.setResourceTimingBufferSize(10_000)
      );
      await use();
    },
    { auto: true },
  ],
});

/**
 * `exampleTest`, failing any test whose page throws, logs a console error
 * or mentions hydration in a console message (`recordPageErrors`). An
 * example's own specs use it too.
 */
export const test = exampleTest.extend<{ failOnPageErrors: void }>({
  // Automatic, as `ignoreAutoPairScan` is: no test names it.
  failOnPageErrors: [
    async ({ app, browser }, use) => {
      await browser.addInitScript(recordPageErrors, pageErrorsKey);
      await use();
      // A test that never opened the app has no page to read.
      if (!(await browser.url()).startsWith(app.baseUrl)) return;
      const errors = await browser.evaluate(
        (key: string) => JSON.parse(sessionStorage.getItem(key) ?? "[]"),
        pageErrorsKey
      );
      expect(
        errors,
        "page errors, console errors and hydration warnings"
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const otherPage = (screen: Screen) =>
  screen.getByText("Other page without Page Objects.");

/** The counter's `output`, whose implicit role is `status`. */
const count = (screen: Screen) =>
  screen.getByRole("region", "Counter").getByRole("status");

/** The published tools of the counter's Page Objects, sorted. */
const counterTools = async (browser: Browser) =>
  (await publishedToolNames(browser))
    .filter((name) => /^(Sub)?CounterPage\./.test(name))
    .sort();

const allCounterTools = [
  "CounterPage.increment",
  "CounterPage.setMode",
  "SubCounterPage.increment",
  "SubCounterPage.setMode",
];

/** ayme's own tools, in publication order: every page that runs ayme has them. */
const aymeTools = [
  "snapshot",
  "page_objects",
  "click",
  "hover",
  "type",
  "fill",
  "check",
  "uncheck",
  "select_option",
  "fill_form",
  "press_key",
  "generate_locator",
  "navigate",
  "navigate_back",
  "navigate_forward",
  "reload",
];

type Fixtures = { app: WebApp; browser: Browser; screen: Screen };

/**
 * Opens the counter page with the recording driver and waits for publication.
 * `inspector` is when the app mounts the Inspector.
 */
async function openCounter(
  { app, browser, screen }: Fixtures,
  inspector: boolean | undefined
) {
  await recordPublishedTools(browser);
  // The test's whole budget, as Playwright's `goto` has it.
  const response = browser.waitForResponse(`${app.baseUrl}${counterPath()}`, {
    timeout: 60_000,
  });
  await browser.goto(counterPath(), { waitUntil: "networkidle" });
  expect((await response).status).toBe(200);
  // No warm-up before the run, unlike the Playwright config's global setup:
  // e2e has none, so the first test that opens the page on the dev server
  // pays for its first compile here.
  await expect(screen.getByRole("status", "Publication")).toHaveText(
    "Publication: active",
    { timeout: server === "dev" ? 45_000 : 15_000 }
  );
  // See `openCounter` in `../tests.ts`: the Inspector's import can hold the
  // main thread past a Page Object action's 1 s timeout until it mounts.
  if (inspector)
    await browser
      .locator("ayme-inspector")
      .waitFor({ state: "attached", timeout: 15_000 });
  await expect(count(screen)).toHaveText("0");
}

/**
 * Calls the published tool `name` with `input` as an agent, for a call that
 * starts a full page load, and resolves with its answer once `loaded` shows
 * on the new page. See `answerAcrossFullLoad` in `../tests.ts`.
 */
async function answerAcrossFullLoad(
  browser: Browser,
  name: string,
  input: Record<string, string>,
  loaded: Locator
): Promise<unknown> {
  await browser.evaluate(
    ({ name, input }: { name: string; input: Record<string, string> }) => {
      const { modelContext } = document as unknown as {
        modelContext: RecordingDriver;
      };
      const tool = modelContext.tools.find((tool) => tool.name === name);
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      setTimeout(() => {
        void tool
          .execute(input)
          .then((answer) =>
            sessionStorage.setItem("full-load-answer", JSON.stringify(answer))
          );
      });
      return null;
    },
    { name, input }
  );
  await expect(loaded).toBeVisible();
  const answer = await browser.evaluate(() =>
    sessionStorage.getItem("full-load-answer")
  );
  return JSON.parse(answer ?? "null");
}

/** The schemas the compiler derives from the counter's Page Object Model. */
const counterSchemas = (pom: string) => [
  {
    name: `${pom}.increment`,
    description: "Run increment.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: `${pom}.setMode`,
    description: "Set counter mode metadata.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["single", "double"] } },
      required: ["mode"],
      additionalProperties: false,
    },
  },
];

/**
 * The counter page in the browser: publication, the compiled tools, the ways
 * to call the Page Object, and registration following the counter's
 * lifetime. The Playwright builder's "runs the same Page Object Model
 * through Playwright" has no counterpart: it runs the app's own Page Object
 * on a Playwright `Page`, which e2e does not hand a test.
 */
export function counterTests({
  navigation,
  inspector,
}: {
  /** Whether this page mounts the Inspector. The tests wait for it to mount. */
  inspector?: boolean;
  navigation?: { away: string; awayText: string; back: string };
}) {
  test.describe("counter", () => {
    test.beforeEach(({ app, browser, screen }) =>
      openCounter({ app, browser, screen }, inspector)
    );

    test("publishes the Page Object's tools with their compiled schemas", async ({
      browser,
    }) => {
      for (const schema of counterSchemas("CounterPage"))
        await expect
          .poll(() => publishedToolSchema(browser, schema.name))
          .toEqual(schema);
    });

    test("publishes an undecorated subclass of a Page Object Model", async ({
      browser,
    }) => {
      for (const schema of counterSchemas("SubCounterPage"))
        await expect
          .poll(() => publishedToolSchema(browser, schema.name))
          .toEqual(schema);
    });

    test("publishes ayme's own tools", async ({ browser }) => {
      await expect
        .poll(() => publishedToolNames(browser))
        .toContain("CounterPage.increment");
      // Every published name without a Page Object's dot.
      expect(
        (await publishedToolNames(browser)).filter(
          (name) => !name.includes(".")
        )
      ).toEqual(aymeTools);
    });

    test("runs the Page Object's action when the app calls it", async ({
      screen,
    }) => {
      await screen.getByRole("button", "Call Page Object").click();
      await expect(count(screen)).toHaveText("1");
    });

    test("runs the Page Object's action through its published tool", async ({
      browser,
      screen,
    }) => {
      await executePublishedTool(browser, "CounterPage.increment");
      await expect(count(screen)).toHaveText("1");
    });

    test("removes the tools on unmount and restores them on remount", async ({
      browser,
      screen,
    }) => {
      await screen.getByRole("button", "Unmount counter").click();
      await expect(screen.getByRole("region", "Counter")).toHaveCount(0);
      await expect.poll(() => counterTools(browser)).toEqual([]);
      await screen.getByRole("button", "Mount counter").click();
      await expect.poll(() => counterTools(browser)).toEqual(allCounterTools);
      // The Page Object acts on the remounted counter.
      await expect(count(screen)).toHaveText("0");
      await screen.getByRole("button", "Call Page Object").click();
      await expect(count(screen)).toHaveText("1");
    });

    test("answers a click on a full page load link before the new page loads", async ({
      browser,
      screen,
    }) => {
      const loading = new URL("/other", await browser.url()).href;
      const answer = await answerAcrossFullLoad(
        browser,
        "click",
        { target: "role=link[name='Full page load']" },
        otherPage(screen)
      );
      expect(await browser.url()).toBe(loading);
      expect(answer).toEqual({
        page_changed: true,
        settled: false,
        changes: expect.stringContaining('link "Full page load"'),
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    });

    test("answers navigate to the other page before it loads, and the other page publishes its tools", async ({
      browser,
      screen,
    }) => {
      const loading = new URL("/other", await browser.url()).href;
      const answer = await answerAcrossFullLoad(
        browser,
        "navigate",
        { url: "/other" },
        otherPage(screen)
      );
      expect(await browser.url()).toBe(loading);
      expect(answer).toMatchObject({
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
      await expect.poll(() => publishedToolNames(browser)).toEqual(aymeTools);
    });

    test("answers navigate_back to the previous document before it loads", async ({
      browser,
      screen,
    }) => {
      const loading = await browser.url();
      await screen.getByRole("link", "Full page load").click();
      await expect.poll(() => publishedToolNames(browser)).toEqual(aymeTools);
      const answer = await answerAcrossFullLoad(
        browser,
        "navigate_back",
        {},
        count(screen)
      );
      expect(await browser.url()).toBe(loading);
      expect(answer).toMatchObject({
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    });

    test("answers reload before the page loads anew", async ({
      browser,
      screen,
    }) => {
      await screen.getByRole("button", "Increment").click();
      await expect(count(screen)).toHaveText("1");
      const loading = await browser.url();
      const answer = await answerAcrossFullLoad(
        browser,
        "reload",
        {},
        count(screen).filter({ hasText: /^0$/ })
      );
      expect(await browser.url()).toBe(loading);
      expect(answer).toMatchObject({
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    });

    test("removes the page's tools on navigation and restores them on return", async ({
      browser,
      screen,
    }) => {
      if (!navigation) return test.skip(true, "The app has one page.");
      await screen.getByRole("link", navigation.away).click();
      await expect(screen.getByText(navigation.awayText)).toBeVisible();
      await expect.poll(() => counterTools(browser)).toEqual([]);
      await screen.getByRole("link", navigation.back).click();
      await expect.poll(() => counterTools(browser)).toEqual(allCounterTools);
      await expect(screen.getByRole("status", "Publication")).toHaveText(
        "Publication: active"
      );
      await screen.getByRole("button", "Call Page Object").click();
      await expect(count(screen)).toHaveText("1");
    });
  });
}

/**
 * The schema of `CounterPage.setMode` once a document has published it. The
 * dev server can reload the page at any moment, so a read that a navigation
 * cuts short is read again, in the new document, until one has published it.
 */
async function publishedModeSchema(browser: Browser) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const schema = await browser
      .evaluate(() => {
        const { modelContext } = document as unknown as {
          modelContext?: RecordingDriver;
        };
        const tool = modelContext?.tools.find(
          (candidate) => candidate.name === "CounterPage.setMode"
        );
        return tool ? JSON.stringify(tool.inputSchema) : "";
      })
      .catch(() => "");
    if (schema) return schema;
    if (Date.now() > deadline)
      throw new Error("No document published CounterPage.setMode in 30 s.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * On the dev server, editing a type the Page Object Model imports rebuilds
 * its published schema without a restart. `counterModePath` is the app's
 * `CounterMode.ts`, as a path or a URL.
 */
export function devRebuildTests({
  counterModePath,
}: {
  counterModePath: string | URL;
}) {
  const counterModeFile =
    typeof counterModePath === "string"
      ? counterModePath
      : fileURLToPath(counterModePath);
  // `exampleTest`, not `test`: the dev server's own reloads may log errors.
  exampleTest.describe("dev rebuild", () => {
    let original: string | undefined;
    // A hook, unlike a `finally` in the test, also runs after a timeout.
    exampleTest.afterEach(async () => {
      if (original !== undefined) await writeFile(counterModeFile, original);
    });

    exampleTest(
      "rebuilds the published schema when an imported type changes",
      async ({ browser }) => {
        exampleTest.skip(server !== "dev", "Production builds do not rebuild.");
        original = await readFile(counterModeFile, "utf8");
        const changed = original.replace('"double"', '"triple"');
        expect(changed).not.toBe(original);
        await recordPublishedTools(browser);

        await browser.goto(counterPath());
        expect(await publishedModeSchema(browser)).toContain('"double"');

        await writeFile(counterModeFile, changed);
        // A hot update may replace the edited module without reloading the
        // page, so the page is reloaded until it publishes the rebuilt
        // schema. When one of the dev server's own reloads aborts ours, it
        // reloads the page all the same.
        while (!(await publishedModeSchema(browser)).includes('"triple"'))
          await browser.reload().catch(() => {});
      }
    );
  });
}

/** The sessionStorage key only the page client's code contains. */
const agentConnectionMarker = "ayme:agent-connection";

/**
 * In the page: the text of every script the document loaded, fetched again
 * from the URLs its resource timing lists. Playwright's builder collects the
 * responses as they arrive; e2e reports no responses to a test but the one
 * it waits for.
 */
const loadedScripts = (browser: Browser) =>
  browser.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .filter(
        (entry) =>
          (entry as PerformanceResourceTiming).initiatorType === "script" ||
          /\.[cm]?[jt]sx?(\?|$)/.test(new URL(entry.name).pathname)
      )
      .map((entry) => entry.name);
    return Promise.all(
      urls.map((url) =>
        fetch(url)
          .then((response) => response.text())
          .catch(() => "")
      )
    );
  });

/**
 * Asks the agent's server for a connect link to `url`, opens it, and waits
 * until the page's tools are MCP tools. `connectPage` from
 * `@ayme-dev/mcp/testing` does the same on a Playwright `Page`.
 */
async function connectPage(
  agent: Agent,
  browser: Browser,
  url: string,
  { timeout = 15_000 }: { timeout?: number } = {}
) {
  const { text, isError } = await agent.call("ayme_connect", { url });
  if (isError) throw new Error(`ayme_connect failed: ${text}`);
  // The link is the answer's first line; a note may follow it.
  await browser.goto(text.split("\n")[0]!);
  const deadline = Date.now() + timeout;
  while (!(await agent.pageToolNames()).includes("page_objects")) {
    if (Date.now() > deadline)
      throw new Error(
        `The page's tools never reached the agent. Server log:\n${agent.log}`
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Resolves once the tab shows a new document: one without the mark this
 * sets in the current one. Stands in for Playwright's `load` event.
 */
async function nextDocument(browser: Browser) {
  await browser.evaluate(() => {
    (window as unknown as { aymeE2eOldDocument: boolean }).aymeE2eOldDocument =
      true;
    return null;
  });
  return async () => {
    await expect
      .poll(
        () =>
          browser
            .evaluate(
              () =>
                document.readyState === "complete" &&
                !("aymeE2eOldDocument" in window)
            )
            .catch(() => false),
        { timeout: 45_000 }
      )
      .toBe(true);
  };
}

/**
 * The Agent Connection, which the app turns on with its own flag. Where
 * `enabled()` holds, a coding agent's MCP client pairs with `/` through a
 * connect link and calls the page's `page_objects` tool, whose tree shows the
 * Page Object `pageObject`. Ported so far: the cases an app with the option always on
 * runs. The App Process cases and "loads no Agent Connection code with the
 * option off" stay in `../tests.ts` until an example that runs them moves.
 */
export function agentConnectionTests({
  enabled,
  pageObject,
  peek = false,
}: {
  /** Whether the run's app turns the option on; read inside each test. */
  enabled: () => boolean;
  /** The class of a Page Object the page at `/` shows. */
  pageObject: string;
  /** Whether the counter adds the Peek `counter` with its `{ count }`. */
  peek?: boolean;
}) {
  exampleTest.describe("agent connection", () => {
    exampleTest(
      "pairs a coding agent through a connect link and runs a page tool",
      async ({ app, browser }) => {
        exampleTest.skip(
          !enabled(),
          "The app turns the Agent Connection off here."
        );
        // Outside the range a page's auto-pair scan probes, so another
        // example's page running beside this one never pairs with it.
        const agent = await startAgent("--port", String(await freePort()));
        try {
          // A dev server may compile the page on its first request, which
          // takes over 10 s on CI.
          await connectPage(agent, browser, `${app.baseUrl}/`, {
            timeout: 45_000,
          });
          // The marker the test with the option off looks for is in the client.
          expect(
            (await loadedScripts(browser)).some((script) =>
              script.includes(agentConnectionMarker)
            )
          ).toBe(true);

          const { text, isError } = await agent.call("page_objects");

          expect(isError, text).toBe(false);
          expect(text).toContain(pageObject);
        } finally {
          await agent.close();
        }
      }
    );

    for (const alreadyLoaded of [false, true]) {
      exampleTest(
        `keeps the tab id across reload after pairing ${alreadyLoaded ? "an already loaded tab" : "as the tab loads"}`,
        async ({ app, browser }) => {
          exampleTest.skip(
            !enabled(),
            "The app turns the Agent Connection off here."
          );
          const agent = await startAgent("--port", String(await freePort()));
          try {
            const url = `${app.baseUrl}/`;
            if (alreadyLoaded)
              await browser.goto(url, { waitUntil: "networkidle" });
            await connectPage(agent, browser, url, { timeout: 45_000 });
            const storedTab = () =>
              browser.evaluate((key: string) => {
                return (
                  JSON.parse(sessionStorage.getItem(key) ?? "") as {
                    tab: string;
                  }
                ).tab;
              }, agentConnectionMarker);
            const tab = await storedTab();

            // The agent's own browser automation reloads the page.
            const navigated = await nextDocument(browser);
            await browser.reload();
            await navigated();
            // Wait for the new document to reconnect before reading its storage.
            const { text, isError } = await agent.call("page_objects");
            expect(isError, text).toBe(false);
            expect(text).toContain(pageObject);
            expect(await storedTab()).toBe(tab);
          } finally {
            await agent.close();
          }
        }
      );
    }

    exampleTest(
      "lets a coding agent read the counter's Peek while it is mounted",
      async ({ app, browser, screen }) => {
        exampleTest.skip(!peek, "The counter adds no Peek here.");
        exampleTest.skip(
          !enabled(),
          "The app turns the Agent Connection off here."
        );
        const agent = await startAgent("--port", String(await freePort()));
        try {
          await connectPage(agent, browser, `${app.baseUrl}/`, {
            timeout: 45_000,
          });
          const readCounter = async () => {
            const { text, isError } = await agent.call("peek.counter");
            expect(isError, text).toBe(false);
            return JSON.parse(text) as unknown;
          };
          const counter = (count: number) => ({
            name: "counter",
            instances: [{ id: expect.any(String), values: { count } }],
          });

          await expect.poll(() => agent.toolNames()).toContain("peek.counter");
          expect(await readCounter()).toEqual(counter(0));

          await screen.getByRole("button", "Increment").click();
          await expect(count(screen)).toHaveText("1");
          expect(await readCounter()).toEqual(counter(1));

          await screen.getByRole("button", "Unmount counter").click();
          await expect
            .poll(() => agent.toolNames())
            .not.toContain("peek.counter");
        } finally {
          await agent.close();
        }
      }
    );
  });
}
