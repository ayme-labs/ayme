import { readFile, writeFile } from "node:fs/promises";

import {
  test as base,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/ayme/testing";
import {
  connectPage,
  freePort,
  ignoreAutoPairScan,
  startAgent,
} from "@ayme-dev/mcp/testing";

import { render, server } from "./config";

/**
 * Whether a console error is Chromium reporting a refused probe of the Agent
 * Connection's auto-pair scan: with no Ayme MCP server running, a localhost
 * page probes `ws://127.0.0.1:<port>/probe` on each port from 9350 to 9365,
 * and Chromium logs every refused connection, whatever the page does. An
 * example's own page-error checks use it too.
 */
export function isRefusedAutoPairProbe(text: string) {
  const port =
    /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:(\d+)\/probe' failed/.exec(
      text
    )?.[1];
  return port !== undefined && Number(port) >= 9350 && Number(port) <= 9365;
}

/**
 * Playwright's `test`, whose pages never pair by themselves with an Ayme MCP
 * server that runs on this machine, such as another suite's: it answers
 * their auto-pair scan as if none ran (`ignoreAutoPairScan`). Every example
 * spec uses it, or `test`, which builds on it.
 */
export const exampleTest = base.extend<{ ignoreAutoPairScan: void }>({
  ignoreAutoPairScan: [
    async ({ context }, use) => {
      await ignoreAutoPairScan(context);
      await use();
    },
    { auto: true },
  ],
});

/**
 * `exampleTest`, failing any test whose page throws, logs a console error
 * or warns about hydration. An example's own specs use it too. It ignores
 * the auto-pair scan's refused probes (`isRefusedAutoPairProbe`).
 */
export const test = exampleTest.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        const text = message.text();
        if (isRefusedAutoPairProbe(text)) return;
        if (message.type() === "error" || /hydrat/i.test(text))
          errors.push(text);
      });
      await use();
      expect(
        errors,
        "page errors, console errors and hydration warnings"
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const otherPage = (page: Page) =>
  page.getByText("Other page without Page Objects.");

const count = (page: Page) =>
  page.getByRole("region", { name: "Counter" }).locator("output");

/** The published tools of the counter's Page Objects, sorted. */
const counterTools = async (page: Page) =>
  (await publishedToolNames(page))
    .filter((name) => /^(Sub)?CounterPage\./.test(name))
    .sort();

const allCounterTools = [
  "CounterPage.increment",
  "CounterPage.setMode",
  "SubCounterPage.increment",
  "SubCounterPage.setMode",
];

/** Ayme's own tools, in publication order: every page that runs Ayme has them. */
const aymeTools = [
  "snapshot",
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

/** Opens the counter page with the recording driver and waits for publication. */
async function openCounter(context: BrowserContext, page: Page) {
  await recordPublishedTools(context);
  // An app may turn the Inspector on in development; it loads after the page,
  // and its mount can hold the main thread past a Page Object action's 1 s
  // timeout, so let it land first.
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
  );
  await expect(count(page)).toHaveText("0");
}

/**
 * Calls the published tool `name` with `input` as an agent, for a call that
 * starts a full page load, and resolves with its answer once `loaded` shows
 * on the new page. Playwright rejects an evaluate still running when the page
 * navigates, even once the page has the answer, so the old document keeps the
 * answer where the new one can read it. The call starts a task after the
 * evaluate returns: a load that needs no network, such as going back to a
 * page the browser kept in its back/forward cache, can otherwise replace the
 * document before the evaluate's own result arrives.
 */
async function answerAcrossFullLoad(
  page: Page,
  name: string,
  input: object,
  loaded: Locator
): Promise<unknown> {
  await page.evaluate(
    ({ name, input }) => {
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
    },
    { name, input }
  );
  await expect(loaded).toBeVisible();
  const answer = await page.evaluate(() =>
    sessionStorage.getItem("full-load-answer")
  );
  return JSON.parse(answer ?? "null");
}

/** The schemas the compiler derives from the counter's Page Object Model. */
const counterSchemas = (pom: string) => [
  {
    name: `${pom}.increment`,
    description: "Increment the counter.",
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
 * The counter page without JavaScript: server-rendered with the initial
 * publication status, or empty in SPA mode.
 */
export function serverRenderTests() {
  test.describe("server render", () => {
    test.use({ javaScriptEnabled: false });

    test("renders no counter on the server in SPA mode", async ({ page }) => {
      test.skip(render !== "spa", "Server rendering is on.");
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(
        0
      );
    });
    test("renders the counter and the initial status on repeated requests", async ({
      page,
    }) => {
      test.skip(render === "spa", "SPA mode renders no server HTML.");
      for (let request = 0; request < 2; request += 1) {
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        await expect(
          page.getByRole("region", { name: "Counter" })
        ).toBeVisible();
        await expect(count(page)).toHaveText("0");
        await expect(
          page.getByRole("status", { name: "Publication" })
        ).toHaveText("Publication: waiting");
        await expect(
          page.getByRole("button", { name: "Call Page Object" })
        ).toBeVisible();
      }
    });
  });
}

/**
 * The counter page in the browser: publication, the compiled tools, the three
 * ways to call the Page Object, and registration following the counter's
 * lifetime. `CounterPage` is the app's own compiled model, used through real
 * Playwright. `navigation`, for an app with a second page, names the links
 * that leave the counter page and return to it.
 */
export function counterTests({
  CounterPage,
  navigation,
}: {
  CounterPage: new (page: Page) => { increment(): Promise<void> };
  navigation?: { away: string; awayText: string; back: string };
}) {
  test.describe("counter", () => {
    test.beforeEach(({ context, page }) => openCounter(context, page));

    test("publishes the Page Object's tools with their compiled schemas", async ({
      page,
    }) => {
      for (const schema of counterSchemas("CounterPage"))
        await expect
          .poll(() => publishedToolSchema(page, schema.name))
          .toEqual(schema);
    });

    test("publishes an undecorated subclass of a Page Object Model", async ({
      page,
    }) => {
      for (const schema of counterSchemas("SubCounterPage"))
        await expect
          .poll(() => publishedToolSchema(page, schema.name))
          .toEqual(schema);
    });

    test("publishes Ayme's own tools", async ({ page }) => {
      await expect
        .poll(() => publishedToolNames(page))
        .toContain("CounterPage.increment");
      // Every published name without a Page Object's dot.
      expect(
        (await publishedToolNames(page)).filter((name) => !name.includes("."))
      ).toEqual(aymeTools);
    });

    test("runs the Page Object's action when the app calls it", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(count(page)).toHaveText("1");
    });

    test("runs the Page Object's action through its published tool", async ({
      page,
    }) => {
      await executePublishedTool(page, "CounterPage.increment");
      await expect(count(page)).toHaveText("1");
    });

    test("runs the same Page Object Model through Playwright", async ({
      page,
    }) => {
      await new CounterPage(page).increment();
      await expect(count(page)).toHaveText("1");
    });

    test("removes the tools on unmount and restores them on remount", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Unmount counter" }).click();
      await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(
        0
      );
      await expect.poll(() => counterTools(page)).toEqual([]);
      await page
        .getByRole("button", { name: "Mount counter", exact: true })
        .click();
      await expect.poll(() => counterTools(page)).toEqual(allCounterTools);
      // The Page Object acts on the remounted counter.
      await expect(count(page)).toHaveText("0");
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(count(page)).toHaveText("1");
    });

    test("answers a click on a full page load link before the new page loads", async ({
      page,
    }) => {
      const loading = new URL("/other", page.url()).href;
      const answer = await answerAcrossFullLoad(
        page,
        "click",
        { target: "role=link[name='Full page load']" },
        otherPage(page)
      );
      expect(page.url()).toBe(loading);
      expect(answer).toEqual({
        page_changed: true,
        settled: false,
        changes: expect.stringContaining('link "Full page load"'),
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    });

    test("answers navigate to the other page before it loads, and the other page publishes its tools", async ({
      page,
    }) => {
      const loading = new URL("/other", page.url()).href;
      const answer = await answerAcrossFullLoad(
        page,
        "navigate",
        { url: "/other" },
        otherPage(page)
      );
      expect(page.url()).toBe(loading);
      expect(answer).toMatchObject({
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
      await expect.poll(() => publishedToolNames(page)).toEqual(aymeTools);
    });

    test("answers navigate_back to the previous document before it loads", async ({
      page,
    }) => {
      const loading = page.url();
      await page.getByRole("link", { name: "Full page load" }).click();
      await expect.poll(() => publishedToolNames(page)).toEqual(aymeTools);
      const answer = await answerAcrossFullLoad(
        page,
        "navigate_back",
        {},
        count(page)
      );
      expect(page.url()).toBe(loading);
      expect(answer).toMatchObject({
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    });

    test("answers reload before the page loads anew", async ({ page }) => {
      await page
        .getByRole("button", { name: "Increment", exact: true })
        .click();
      await expect(count(page)).toHaveText("1");
      const loading = page.url();
      const answer = await answerAcrossFullLoad(
        page,
        "reload",
        {},
        count(page).filter({ hasText: /^0$/ })
      );
      expect(page.url()).toBe(loading);
      expect(answer).toMatchObject({
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    });

    test("removes the page's tools on navigation and restores them on return", async ({
      page,
    }) => {
      if (!navigation) return test.skip(true, "The app has one page.");
      await page.getByRole("link", { name: navigation.away }).click();
      await expect(page.getByText(navigation.awayText)).toBeVisible();
      await expect.poll(() => counterTools(page)).toEqual([]);
      await page.getByRole("link", { name: navigation.back }).click();
      await expect.poll(() => counterTools(page)).toEqual(allCounterTools);
      await expect(
        page.getByRole("status", { name: "Publication" })
      ).toHaveText("Publication: active");
      await page.getByRole("button", { name: "Call Page Object" }).click();
      await expect(count(page)).toHaveText("1");
    });
  });
}

/**
 * On the dev server, editing a type the Page Object Model imports rebuilds
 * its published schema without a restart. `counterModePath` is the app's
 * `CounterMode.ts`.
 */
export function devRebuildTests({
  counterModePath,
}: {
  counterModePath: string;
}) {
  // `exampleTest`, not `test`: the dev server's own reloads may log errors.
  exampleTest.describe("dev rebuild", () => {
    let original: string | undefined;
    // A hook, unlike a `finally` in the test, also runs after a timeout.
    exampleTest.afterEach(async () => {
      if (original !== undefined) await writeFile(counterModePath, original);
    });

    exampleTest(
      "rebuilds the published schema when an imported type changes",
      async ({ context, page }) => {
        exampleTest.skip(server !== "dev", "Production builds do not rebuild.");
        original = await readFile(counterModePath, "utf8");
        const changed = original.replace('"double"', '"triple"');
        expect(changed).not.toBe(original);
        await recordPublishedTools(context);
        // The dev server can reload the page at any moment, so the schema is
        // read inside one wait, which Playwright re-runs in each new document
        // until one has published it.
        const publishedModeSchema = () =>
          page
            .waitForFunction(
              () => {
                const { modelContext } = document as unknown as {
                  modelContext: RecordingDriver;
                };
                const tool = modelContext.tools.find(
                  (candidate) => candidate.name === "CounterPage.setMode"
                );
                return tool ? JSON.stringify(tool.inputSchema) : "";
              },
              undefined,
              { timeout: 30_000 }
            )
            .then((schema) => schema.jsonValue());

        await page.goto("/");
        expect(await publishedModeSchema()).toContain('"double"');

        await writeFile(counterModePath, changed);
        // A hot update may replace the edited module without reloading the
        // page, so the page is reloaded until it publishes the rebuilt schema.
        // The load event fires before the app's modules run, so each document
        // is given until it publishes; reloading on a timer instead can cut
        // every document short on a slow runner. When one of the dev server's
        // own reloads aborts ours, it reloads the page all the same.
        while (!(await publishedModeSchema()).includes('"triple"'))
          await page.reload().catch(() => {});
      }
    );
  });
}

/** The sessionStorage key only the page client's code contains. */
const agentConnectionMarker = "ayme:agent-connection";

/** Collects the text of every script the page loads from now on. */
function loadedScripts(page: Page) {
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(response.text().catch(() => ""));
  });
  return () => Promise.all(scripts);
}

/**
 * The Agent Connection, which the app turns on with its own flag. Where
 * `enabled()` holds, a coding agent's MCP client pairs with `/` through a
 * connect link and calls the page's `snapshot` tool, whose structure contains
 * `snapshotText`. Elsewhere, such as a production build, the page loads no
 * Agent Connection code and opens no WebSocket.
 */
export function agentConnectionTests({
  enabled,
  snapshotText,
}: {
  /** Whether the run's app turns the option on; read inside each test. */
  enabled: () => boolean;
  snapshotText: string;
}) {
  // `exampleTest`, not `test`: Angular's development build logs its
  // hydration statistics, which `test` counts as a hydration warning.
  exampleTest.describe("agent connection", () => {
    exampleTest(
      "pairs a coding agent through a connect link and runs a page tool",
      async ({ page, baseURL }) => {
        exampleTest.skip(
          !enabled(),
          "The app turns the Agent Connection off here."
        );
        const scripts = loadedScripts(page);
        // Outside the range a page's auto-pair scan probes, so another
        // example's page running beside this one never pairs with it.
        const agent = await startAgent("--port", String(await freePort()));
        try {
          // A dev server may compile the page on its first request, which
          // takes over 10 s on CI.
          await connectPage(agent, page, new URL("/", baseURL).href, {
            timeout: 45_000,
          });
          // The marker the test with the option off looks for is in the client.
          expect(
            (await scripts()).some((script) =>
              script.includes(agentConnectionMarker)
            )
          ).toBe(true);

          const { text, isError } = await agent.call("snapshot");

          expect(isError, text).toBe(false);
          expect(
            (JSON.parse(text) as { structure: string }).structure
          ).toContain(snapshotText);
        } finally {
          await agent.close();
        }
      }
    );

    exampleTest(
      "loads no Agent Connection code with the option off",
      async ({ page }) => {
        exampleTest.skip(
          enabled(),
          "The app turns the Agent Connection on here."
        );
        const sockets: string[] = [];
        page.on("websocket", (socket) => sockets.push(socket.url()));
        const scripts = loadedScripts(page);

        await page.goto("/", { waitUntil: "networkidle" });

        expect(
          (await scripts()).filter((script) =>
            script.includes(agentConnectionMarker)
          )
        ).toEqual([]);
        expect(sockets).toEqual([]);
      }
    );
  });
}
