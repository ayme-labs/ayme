import { spawn } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { selectors } from "@playwright/test";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import {
  aymeCommand,
  connectPage,
  expect,
  freePort,
  startAgent,
  test,
} from "./fixtures";

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

    // The short answer an agent gets from a Page Object Tool, and nothing
    // of the server's.
    const { text, isError, note } = await agent.call(PLAIN_PAGE_TOOL);
    expect(isError, text).toBe(false);
    const answer = JSON.parse(text) as Record<string, unknown>;
    expect(answer).toMatchObject({
      settled: true,
      result: expect.stringContaining("does not run Ayme"),
    });
    expect(Object.keys(answer)).toEqual(["settled", "result"]);
    expect(note).toBeUndefined();
  } finally {
    await agent.close();
  }
});

test("an app that ships Ayme keeps its own runtime, and ayme mcp's init script starts no second one", async ({
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
    const followed: string[] = [];
    page.on("websocket", (socket) => {
      if (socket.url().includes("/page-objects/")) followed.push(socket.url());
    });

    await connectPage(agent, page, `${baseURL}/`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain("read_text");
    // The init script decides once the page has loaded and gone idle; an
    // idle callback asked for after the load runs after its own.
    await page.waitForLoadState("load");
    await page.evaluate(
      () => new Promise((resolve) => requestIdleCallback(resolve))
    );

    expect(followed).toEqual([]);
    expect(await agent.pageToolNames()).not.toContain(PLAIN_PAGE_TOOL);
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

test("after an edit to a Page Object the entry imports, the open page swaps in the changed tools without a reload", async ({
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
    // A mark on this document, which a reload would drop.
    await page.evaluate(() => {
      document.documentElement.dataset.before = "edit";
    });

    await editPlainPage(project, withReadTitle);

    await expect
      .poll(() => agent.pageToolNames(), {
        ...REBUILT_WITHIN,
        message: agent.log,
      })
      .toContain("PlainPage.readTitle");
    expect(await agent.pageToolNames()).toContain(PLAIN_PAGE_TOOL);
    expect(
      await page.evaluate(() => document.documentElement.dataset.before)
    ).toBe("edit");
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
    // The one error, where it is in the file as written.
    expect(agent.log).toMatch(/pom[\\/]PlainPage\.ts:22:1: '}' expected\.\n/);
    expect(agent.log.match(/PlainPage\.ts:\d+:\d+: /g)).toHaveLength(1);
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

test("while the entry has never built, ayme_connect and the no-page answers say why, until a fix builds it", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  // A tsconfig.json whose `include` misses `.ayme`, so TypeScript finds no
  // inputs and the Page Object compiler fails.
  const tsconfig = join(project, "tsconfig.json");
  const withInclude = (include: string) =>
    JSON.stringify({
      compilerOptions: { experimentalDecorators: true },
      include: [include],
    });
  await writeFile(tsconfig, withInclude("src"));
  const agent = await startAgent(
    { cwd: project },
    "--port",
    String(await freePort())
  );
  try {
    const entry = join(project, ".ayme", "page-objects.ts");
    const initScript = join(project, ".ayme", "init-script.js");
    const url = `${baseURL}/plain.html`;

    const failing = await agent.call("ayme_connect", { url });
    expect(failing.isError, failing.text).toBe(false);
    expect(failing.note).toContain(
      `The Page Objects entry ${entry} did not build`
    );
    expect(failing.note).toContain("No inputs were found in config file");
    expect(failing.note).toContain(
      "The server is watching for changes: it rebuilds the entry when a file it read changes."
    );
    expect(failing.note).not.toContain("Fix it");
    expect(failing.note).not.toContain("Make the");
    expect(failing.note).not.toMatch(/^This server serves Page Objects/);
    for (const tool of ["ayme_list_tools", "snapshot"]) {
      const { text, isError } = await agent.call(tool);
      expect(isError).toBe(true);
      expect(text).toMatch(
        /^No page is connected\. The Page Objects entry .* did not build/
      );
      expect(text).toContain("No inputs were found in config file");
      expect(text).toContain(
        "The server is watching for changes: it rebuilds the entry when a file it read changes."
      );
      expect(text).not.toContain("Fix it");
      expect(text).not.toContain("Make the");
    }

    await writeFile(tsconfig, withInclude(".ayme/**/*.ts"));
    await expect
      .poll(() => agent.log, REBUILT_WITHIN)
      .toContain(`Built the Page Objects entry ${entry}.`);

    const built = await agent.call("ayme_connect", { url });
    expect(built.note).toBe(
      `This server serves Page Objects to pages that load ${initScript}.`
    );
    expect(await agent.call("ayme_list_tools")).toMatchObject({
      text: "No page is connected.",
      isError: true,
    });
    await context.addInitScript({ path: initScript });
    await connectPage(agent, page, url);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);
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

// Playwright reads a test's fixtures from this pattern.
// eslint-disable-next-line no-empty-pattern
test("with a Page Objects entry, ayme mcp still exits when its port is taken, its build watcher stopped", async ({}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  const taken = createServer();
  await new Promise<void>((resolve) =>
    taken.listen(0, "127.0.0.1", () => resolve())
  );
  const port = (taken.address() as AddressInfo).port;
  try {
    const server = spawn(
      process.execPath,
      [aymeCommand, "mcp", "--port", String(port)],
      { cwd: project, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stderr = "";
    server.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));

    const exitCode = await new Promise<number | null>((resolve) =>
      server.once("exit", resolve)
    );

    expect(exitCode, stderr).toBe(1);
    expect(stderr).toContain(`Port ${port} is in use`);
  } finally {
    await new Promise((resolve) => taken.close(resolve));
  }
});
