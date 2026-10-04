import { readFile, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";

import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/ayme/testing";
import { connectPage, startAgent } from "@ayme-dev/mcp/testing";

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
 * Playwright's `test`, failing any test whose page throws, logs a console
 * error or warns about hydration. An example's own specs use it too. It
 * ignores the auto-pair scan's refused probes (`isRefusedAutoPairProbe`).
 */
export const test = base.extend<{ failOnPageErrors: void }>({
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
      ).toEqual([
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
      ]);
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
  // Plain Playwright `test`: the dev server's own reloads may log errors.
  base.describe("dev rebuild", () => {
    let original: string | undefined;
    // A hook, unlike a `finally` in the test, also runs after a timeout.
    base.afterEach(async () => {
      if (original !== undefined) await writeFile(counterModePath, original);
    });

    base(
      "rebuilds the published schema when an imported type changes",
      async ({ context, page }) => {
        base.skip(server !== "dev", "Production builds do not rebuild.");
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
  // Plain Playwright `test`: Angular's development build logs its hydration
  // statistics, which `test` counts as a hydration warning.
  base.describe("agent connection", () => {
    base(
      "pairs a coding agent through a connect link and runs a page tool",
      async ({ page, baseURL }) => {
        base.skip(!enabled(), "The app turns the Agent Connection off here.");
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

    base(
      "loads no Agent Connection code with the option off",
      async ({ page }) => {
        base.skip(enabled(), "The app turns the Agent Connection on here.");
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

/**
 * A free port of the loopback interface that the system picks, outside the
 * Ayme MCP server's range of 9350 to 9365.
 */
function freePort() {
  return new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
