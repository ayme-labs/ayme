import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { selectors } from "@playwright/test";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import { connectPage, expect, freePort, startAgent, test } from "./fixtures";

// The Inspector renders into a closed shadow root; its page objects reach it
// through these selectors.
test.beforeAll(() => registerInspectorSelectors(selectors));

/**
 * The `.ayme` folder of a project that keeps its Page Objects outside the
 * app: the entry and the Page Object of `plain.html` it lists.
 */
const OUTSIDE_THE_APP = fileURLToPath(
  new URL("../outside/.ayme", import.meta.url)
);

/** The Page Object Tool of the entry's `PlainPage`. */
const PLAIN_PAGE_TOOL = "PlainPage.readNote";

/** The entry's `PlainPage`, with `edit` applied to its source. */
async function editPlainPage(
  project: string,
  edit: (source: string) => string
) {
  const file = join(project, ".ayme", "pom", "PlainPage.ts");
  await writeFile(file, edit(await readFile(file, "utf8")));
}

/**
 * How long a rebuild may take to show in the server's log: esbuild's watch
 * mode polls the files, and notices a change after seconds.
 */
const REBUILT_WITHIN = { timeout: 20_000 };

/** `PlainPage` with a second action, `readTitle`. */
const withReadTitle = (source: string) =>
  source.replace(
    "  async readNote() {",
    `  async readTitle() {
    return "Without Ayme";
  }

  @ayme.action({ description: "Read the page's note." })
  async readNote() {`
  );

test("a page without Ayme gets the Page Objects ayme mcp serves through the init script it writes", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  // A project folder beside the fixture's own packages, as a project's
  // `.ayme` sits beside its installed `@ayme-dev/ayme`.
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  const port = await freePort();
  const agent = await startAgent({ cwd: project }, "--port", String(port));
  try {
    const initScript = join(project, ".ayme", "init-script.js");
    expect(await readFile(initScript, "utf8")).toContain(
      `http://127.0.0.1:${port}/`
    );
    await context.addInitScript({ path: initScript });

    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);

    const { text, isError } = await agent.call(PLAIN_PAGE_TOOL);
    expect(isError, text).toBe(false);
    expect(text).toContain("does not run Ayme");
  } finally {
    await agent.close();
  }
});

test("--page-objects points ayme mcp at an entry elsewhere", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, "agent"), { recursive: true });
  const agent = await startAgent(
    { cwd: project },
    "--port",
    String(await freePort()),
    "--page-objects",
    "agent/page-objects.ts"
  );
  try {
    await context.addInitScript({
      path: join(project, ".ayme", "init-script.js"),
    });

    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);
  } finally {
    await agent.close();
  }
});

test("after an edit to a Page Object the entry imports, a reload shows the changed tools", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  const agent = await startAgent(
    { cwd: project },
    "--port",
    String(await freePort())
  );
  try {
    await context.addInitScript({
      path: join(project, ".ayme", "init-script.js"),
    });
    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);

    await editPlainPage(project, withReadTitle);
    await expect
      .poll(() => agent.log, REBUILT_WITHIN)
      .toMatch(/Rebuilt the Page Objects entry/);
    await page.reload();

    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain("PlainPage.readTitle");
    const { text, isError } = await agent.call("PlainPage.readTitle");
    expect(isError, text).toBe(false);
    expect(text).toContain("Without Ayme");
  } finally {
    await agent.close();
  }
});

test("a Page Object that fails to compile is reported with its file, and the page keeps the last good build", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  const agent = await startAgent(
    { cwd: project },
    "--port",
    String(await freePort())
  );
  try {
    await context.addInitScript({
      path: join(project, ".ayme", "init-script.js"),
    });
    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);

    await editPlainPage(project, (source) =>
      source.replace("async readNote() {", "async readNote() {{")
    );
    await expect
      .poll(() => agent.log, REBUILT_WITHIN)
      .toMatch(
        /did not build\. The page gets the last good build\.\n[^\n]*pom[\\/]PlainPage\.ts\b/
      );
    await page.reload();

    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);
    const { isError, text } = await agent.call(PLAIN_PAGE_TOOL);
    expect(isError, text).toBe(false);
  } finally {
    await agent.close();
  }
});

test("the Inspector ayme_inspect links to shows the served Page Objects of the paired page, runs them there, and loads none itself", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  const agent = await startAgent(
    { cwd: project },
    "--port",
    String(await freePort())
  );
  try {
    await context.addInitScript({
      path: join(project, ".ayme", "init-script.js"),
    });
    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);

    const { text: url, isError } = await agent.call("ayme_inspect");
    expect(isError, url).toBe(false);
    const window = await context.newPage();
    const servedToWindow: string[] = [];
    window.on("request", (request) => {
      if (request.url().includes("/page-objects/"))
        servedToWindow.push(request.url());
    });
    await window.goto(url);
    const inspector = new Inspector(window);
    await (await inspector.tool(PLAIN_PAGE_TOOL)).run();

    const run = inspector.runs.latest(PLAIN_PAGE_TOOL);
    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.resultText()).toContain("does not run Ayme");
    // The init script leaves ayme mcp's own pages alone.
    expect(servedToWindow).toEqual([]);
  } finally {
    await agent.close();
  }
});
